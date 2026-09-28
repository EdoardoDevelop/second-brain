import "server-only";
import { z } from "zod";
import { ne } from "drizzle-orm";
import { db } from "./db";
import { ITEM_TYPES, people, projects, type Proposal } from "./db/schema";
import { callJSON, callLLM } from "./llm";
import { getAiConfig, type AiTier } from "./settings";

export const aiEnabled = async () => !!(await getAiConfig()).apiKey;

/**
 * Chiamata all'IA con output JSON strutturato, validato con Zod. `tier` sceglie il modello (vedi llm.ts):
 * fast per la routine, files per foto/PDF/audio, smart per il ragionamento.
 */
type UserContent = string | (
  | { type: "text"; text: string }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } }
)[];

async function complete<T extends z.ZodType>(schema: T, name: string, system: string, user: UserContent, maxTokens = 4000, tier: AiTier = "fast"): Promise<z.infer<T>> {
  return callJSON<z.infer<T>>({
    tier, task: name, name, maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    jsonSchema: z.toJSONSchema(schema),
    parse: (v) => schema.safeParse(v) as { success: true; data: z.infer<T> } | { success: false },
  });
}

export type MemoryContext = {
  projects: { id: string; name: string; description: string }[];
  people: { name: string; role: string }[];
  items: { id: string; type: string | null; title: string; summary: string | null; date: string }[];
};

const ProposalSchema = z.object({
  type: z.enum(ITEM_TYPES),
  title: z.string().describe("Titolo breve e specifico, max 70 caratteri"),
  topic: z.string().describe("Argomento in poche parole"),
  summary: z.string().describe("Sintesi in 1-2 frasi, in italiano"),
  people: z.array(z.string()).describe("Nomi delle persone menzionate; usa i nomi esistenti quando corrispondono"),
  projectId: z.string().nullable().describe("id di un progetto esistente, oppure null"),
  tags: z.array(z.string()).describe("2-4 tag minuscoli, senza #"),
  links: z
    .array(z.object({ id: z.string(), conflict: z.boolean(), reason: z.string() }))
    .describe("Elementi esistenti collegati (max 4). conflict=true se il contenuto li contraddice"),
  tasks: z.array(z.string()).describe("Attività concrete che emergono dal contenuto, anche nessuna"),
});

const SYSTEM = `Sei il motore di classificazione di un "Second Brain" personale, in italiano.
Ricevi un contenuto appena catturato e il contesto della memoria esistente.
Proponi come archiviarlo. La proposta verrà confermata o corretta dall'utente: non inventare fatti.
Collega solo elementi davvero pertinenti e segnala come conflitto solo una contraddizione reale (es. una decisione presa e un'idea che va nella direzione opposta).
Usa solo id di progetti ed elementi presenti nel contesto.`;


export async function classify(content: string, ctx: MemoryContext): Promise<Proposal> {
  const out = await complete(
    ProposalSchema,
    "proposta",
    SYSTEM,
    `<memoria>\n${JSON.stringify(ctx)}\n</memoria>\n\n<contenuto_catturato>\n${content}\n</contenuto_catturato>`,
  );

  const projectIds = new Set(ctx.projects.map((p) => p.id));
  const itemIds = new Set(ctx.items.map((i) => i.id));
  return {
    ...out,
    projectId: out.projectId && projectIds.has(out.projectId) ? out.projectId : null,
    links: out.links.filter((l) => itemIds.has(l.id)).slice(0, 4),
    tags: out.tags.map((t) => t.replace(/^#/, "").toLowerCase()).slice(0, 6),
  };
}

/** Proposta senza IA: l'utente classifica a mano. */
export function manualProposal(content: string): Proposal {
  const firstLine = content.split("\n")[0].trim();
  return {
    type: "Nota",
    title: firstLine.length > 70 ? firstLine.slice(0, 67) + "…" : firstLine,
    topic: "",
    summary: "",
    people: [],
    projectId: null,
    tags: [],
    links: [],
    tasks: [],
  };
}

const ActionSchema = z.object({
  title: z.string(),
  paragraphs: z.array(z.string()),
  list: z.array(z.string()),
});
export type AiActionResult = z.infer<typeof ActionSchema>;

const ACTION_PROMPTS = {
  summarize: "Scrivi una sintesi fedele dell'elemento in 2-3 frasi (paragraphs). list vuota. title: \"Sintesi\".",
  explain: "Spiega il contesto dell'elemento: perché conta e come si collega al resto della memoria (paragraphs, max 2). list vuota. title: \"Spiegazione\".",
  actions: "Proponi 2-4 attività concrete e brevi che derivano dall'elemento (list). paragraphs vuoto. title: \"Attività proposte\".",
} as const;
export type AiActionKind = keyof typeof ACTION_PROMPTS;

export async function runItemAction(kind: AiActionKind, item: { title: string; content: string; summary: string | null }, related: string[]) {
  return complete(
    ActionSchema,
    "azione",
    "Sei l'assistente di un Second Brain personale. Rispondi in italiano, conciso, senza inventare fatti.",
    `<elemento>\n${JSON.stringify(item)}\n</elemento>\n<collegati>\n${related.join("\n")}\n</collegati>\n\n${ACTION_PROMPTS[kind]}`,
    4000,
    "smart",
  );
}

// ——— Comandi (voce o testo) ———

export const COMMAND_KINDS = [
  "capture", "add_task", "complete_task", "reopen_task", "set_task_due", "update_task", "delete_task",
  "create_project", "update_project", "add_goal", "complete_goal", "reopen_goal", "delete_goal", "upsert_person",
  "update_item", "append_item", "archive_item", "favorite_item", "link_items",
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

export const CommandActionSchema = z.object({
  kind: z.enum(COMMAND_KINDS),
  label: z.string().describe("Descrizione breve dell'azione per l'utente, in italiano"),
  text: z.string().nullable().describe("capture: il contenuto da catturare, riscritto in forma pulita; append_item: il testo da aggiungere all'elemento"),
  title: z.string().nullable().describe("add_task: titolo dell'attività; add_goal: testo dell'obiettivo; create_project: nome del progetto; update_task, update_item: nuovo titolo"),
  goalId: z.string().nullable().describe("complete_goal, reopen_goal, delete_goal: id di un obiettivo esistente"),
  taskId: z.string().nullable().describe("complete_task, reopen_task, set_task_due, update_task, delete_task: id di un'attività esistente"),
  due: z.string().nullable().describe("add_task, set_task_due, update_task: data YYYY-MM-DD oppure null"),
  time: z.string().nullable().describe("add_task, set_task_due, update_task: orario HH:MM (24 ore) se l'utente lo indica, altrimenti null"),
  remind: z.number().nullable().describe("add_task, set_task_due, update_task: minuti di anticipo del promemoria (0 = all'orario, 60 = un'ora prima); null se non richiesto"),
  prio: z.number().nullable().describe("add_task, update_task: priorità 1 (alta), 2 (media), 3 (bassa)"),
  projectId: z.string().nullable().describe("add_task, add_goal, update_task, update_project, update_item: id di un progetto esistente"),
  itemId: z.string().nullable().describe("update_item, append_item, archive_item, favorite_item, link_items: id di un elemento della memoria"),
  targetId: z.string().nullable().describe("link_items: id del secondo elemento"),
  summary: z.string().nullable().describe("update_item: nuova sintesi"),
  tags: z.array(z.string()).nullable().describe("update_item: tag da aggiungere (senza #)"),
  removeTags: z.array(z.string()).nullable().describe("update_item: tag da togliere"),
  addPeople: z.array(z.string()).nullable().describe("update_item: id di persone esistenti da collegare all'elemento"),
  reason: z.string().nullable().describe("link_items: perché i due elementi sono collegati"),
  conflict: z.boolean().nullable().describe("link_items: true se i due elementi si contraddicono; favorite_item: false per togliere dai preferiti"),
  status: z.enum(["Attivo", "In pausa", "Chiuso"]).nullable().describe("create_project, update_project"),
  pct: z.number().nullable().describe("create_project, update_project: avanzamento 0-100"),
  next: z.string().nullable().describe("create_project, update_project: prossima milestone"),
  description: z.string().nullable().describe("create_project, update_project: descrizione"),
  personId: z.string().nullable().describe("upsert_person: id di una persona esistente da modificare, null per crearne una"),
  name: z.string().nullable().describe("upsert_person: nome"),
  role: z.string().nullable(),
  org: z.string().nullable(),
  email: z.string().nullable(),
  note: z.string().nullable().describe("upsert_person: note personali da aggiungere"),
});
export type CommandAction = z.infer<typeof CommandActionSchema>;

const CommandSchema = z.object({
  transcript: z.string().describe("Trascrizione fedele dell'audio, oppure il testo ricevuto"),
  actions: z.array(CommandActionSchema).describe("Azioni da proporre, nell'ordine; vuoto se non si capisce la richiesta"),
});
export type CommandResult = z.infer<typeof CommandSchema>;

export type CommandContext = {
  today: string;
  projects: { id: string; name: string; status: string; pct: number }[];
  people: { id: string; name: string; role: string; org: string }[];
  tasks: { id: string; title: string; due: string | null; projectId: string | null; done?: boolean }[];
  goals: { id: string; title: string; projectId: string; done: boolean }[];
  items: { id: string; type: string | null; date: string; title: string; tags: string[] }[];
};

const COMMAND_SYSTEM = `Sei l'interprete dei comandi di un "Second Brain" personale, in italiano.
Ricevi una richiesta (audio da trascrivere o testo) e il contesto: data di oggi, progetti, persone, attività (aperte e completate di recente, con done) ed elementi della memoria (note, documenti, riunioni…).
Trasforma la richiesta in azioni. Verranno mostrate all'utente, che le conferma: non inventare nulla. Compila solo i campi che servono all'azione, gli altri null.
- capture: per note, idee, resoconti o qualsiasi informazione nuova da archiviare. È la scelta predefinita se la richiesta non è un comando.
- add_task: nuova attività. Date relative ("venerdì", "domani") convertite in YYYY-MM-DD rispetto a oggi; il nome di un giorno indica la sua prossima occorrenza dopo oggi (se oggi è venerdì, "venerdì" è tra 7 giorni), salvo "oggi". prio solo se l'utente la indica ("urgente" = 1).
- complete_task, reopen_task, set_task_due, delete_task: solo su attività esistenti, indicate con il loro id. reopen_task solo per attività con done true.
- Orari e promemoria: "alle 15", "domani alle 9:30" → time in HH:MM. "Ricordami", "avvisami", "promemoria" con un orario → remind 0, oppure i minuti di anticipo richiesti ("mezz'ora prima" = 30). Se c'è un orario senza giorno, il giorno è oggi se l'orario non è passato, altrimenti domani. Senza orario non c'è promemoria: time e remind null.
- update_task: rinomina, sposta in un progetto o cambia priorità o scadenza di un'attività esistente.
- create_project, update_project: per update_project usa l'id esistente e compila solo i campi da cambiare.
- add_goal: nuovo obiettivo di un progetto esistente (projectId obbligatorio). complete_goal ("abbiamo raggiunto…"), reopen_goal, delete_goal: su obiettivi esistenti, con goalId. Un obiettivo è un risultato da raggiungere; un'attività è una cosa da fare: se l'utente dice "obiettivo" usa add_goal.
- upsert_person: personId esistente per modificare, null per creare. Compila solo i campi citati.
- update_item: modifica un elemento della memoria (titolo, sintesi, progetto, tag da aggiungere o togliere, persone da collegare).
- append_item: aggiunge un'informazione a un elemento esistente ("aggiungi alla nota della riunione che…"). Preferiscilo a capture solo se l'utente indica chiaramente l'elemento.
- archive_item: archivia un elemento. favorite_item: aggiunge ai preferiti (conflict false per toglierlo).
- link_items: collega due elementi della memoria tra loro (itemId e targetId sono entrambi id di elementi), con reason; conflict true se si contraddicono.
- Collegare, assegnare o spostare un elemento in un progetto ("collega il documento X al progetto Y") è update_item con itemId e projectId. Collegare una persona a un elemento è update_item con addPeople. Non usare link_items per progetti o persone.
Usa solo id presenti nel contesto. Se un riferimento è ambiguo o manca, scegli capture con il testo originale.`;

export async function interpretCommand(input: { text?: string; audio?: { data: string; format: string } }, ctx: CommandContext): Promise<CommandResult> {
  const context = `<contesto>\n${JSON.stringify(ctx)}\n</contesto>`;
  const user: UserContent = input.audio
    ? [{ type: "text", text: `${context}\n\nLa richiesta è nell'audio allegato: trascrivilo e interpretalo.` }, { type: "input_audio", input_audio: input.audio }]
    : `${context}\n\n<richiesta>\n${input.text ?? ""}\n</richiesta>`;
  const out = await complete(CommandSchema, "comando", COMMAND_SYSTEM, user, 4000, input.audio ? "files" : "smart");
  return { transcript: out.transcript, actions: cleanActions(out.actions, ctx) };
}

/** Schema JSON di un'azione proposta (per lo strumento propose_actions dell'Assistente). */
export const commandActionJsonSchema = () => z.toJSONSchema(z.object({ actions: z.array(CommandActionSchema) }));

/**
 * Normalizza le azioni proposte dall'IA: date, orari e numeri validi, id esistenti,
 * link_items verso progetti o persone trasformato nell'assegnazione corrispondente; scarta quelle incomplete.
 */
export function cleanActions(raw: unknown[], ctx: CommandContext): CommandAction[] {
  const parsed = z.array(CommandActionSchema.partial().extend({ kind: z.enum(COMMAND_KINDS), label: z.string() })).safeParse(raw);
  if (!parsed.success) return [];
  const nul = <T,>(v: T | undefined) => (v === undefined ? null : v);
  const full: CommandAction[] = parsed.data.map((a) => Object.fromEntries(Object.keys(CommandActionSchema.shape).map((k) => [k, nul((a as Record<string, unknown>)[k])])) as CommandAction);
  const taskIds = new Set(ctx.tasks.map((t) => t.id));
  const projectIds = new Set(ctx.projects.map((p) => p.id));
  const personIds = new Set(ctx.people.map((p) => p.id));
  const itemIds = new Set(ctx.items.map((i) => i.id));
  const goalIds = new Set(ctx.goals.map((g) => g.id));
  const validDay = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const cleanTags = (t: string[] | null) => (t ? [...new Set(t.map((x) => x.trim().replace(/^#/, "")).filter(Boolean))] : null);
  return full
    // Se l'IA usa link_items verso un progetto o una persona, lo trasforma nell'assegnazione corrispondente.
    .map((a) =>
      a.kind === "link_items" && a.targetId && projectIds.has(a.targetId) ? { ...a, kind: "update_item" as const, projectId: a.targetId, targetId: null }
      : a.kind === "link_items" && a.targetId && personIds.has(a.targetId) ? { ...a, kind: "update_item" as const, addPeople: [a.targetId], targetId: null }
      : a,
    )
    .map((a) => ({
      ...a,
      due: validDay(a.due),
      time: a.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(a.time) ? a.time : null,
      remind: a.remind == null ? null : Math.max(0, Math.min(10080, Math.round(a.remind))),
      prio: a.prio == null ? null : Math.max(1, Math.min(3, Math.round(a.prio))),
      projectId: a.projectId && projectIds.has(a.projectId) ? a.projectId : null,
      personId: a.personId && personIds.has(a.personId) ? a.personId : null,
      taskId: a.taskId && taskIds.has(a.taskId) ? a.taskId : null,
      goalId: a.goalId && goalIds.has(a.goalId) ? a.goalId : null,
      itemId: a.itemId && itemIds.has(a.itemId) ? a.itemId : null,
      targetId: a.targetId && itemIds.has(a.targetId) && a.targetId !== a.itemId ? a.targetId : null,
      tags: cleanTags(a.tags),
      removeTags: cleanTags(a.removeTags),
      addPeople: a.addPeople ? a.addPeople.filter((id) => personIds.has(id)) : null,
      pct: a.pct == null ? null : Math.max(0, Math.min(100, Math.round(a.pct))),
    }))
    // Scarta le azioni che puntano a elementi inesistenti.
    .filter((a) => {
      switch (a.kind) {
        case "complete_task": case "reopen_task": case "set_task_due": case "update_task": case "delete_task": return !!a.taskId;
        case "update_project": return !!a.projectId;
        case "add_goal": return !!a.projectId && !!a.title?.trim();
        case "complete_goal": case "reopen_goal": case "delete_goal": return !!a.goalId;
        case "capture": return !!a.text?.trim();
        case "add_task": case "create_project": return !!a.title?.trim();
        case "upsert_person": return !!(a.personId || a.name?.trim());
        case "append_item": return !!a.itemId && !!a.text?.trim();
        case "update_item": case "archive_item": case "favorite_item": return !!a.itemId;
        case "link_items": return !!a.itemId && !!a.targetId;
        default: return false;
      }
    });
}

// ——— Assistente: domande alla memoria con fonti ———

export type ChatTurn = { role: "user" | "assistant"; text: string };

/** Formati audio accettati da OpenRouter, ricavati dal tipo MIME o dall'estensione. */
const AUDIO_FORMATS: Record<string, string> = { wav: "wav", "x-wav": "wav", wave: "wav", mpeg: "mp3", mp3: "mp3", mp4: "m4a", m4a: "m4a", "x-m4a": "m4a", aac: "aac", ogg: "ogg", flac: "flac", webm: "webm", aiff: "aiff" };
export const audioFormat = (mime: string, name: string) =>
  AUDIO_FORMATS[mime.split("/")[1]?.split(";")[0] ?? ""] ?? AUDIO_FORMATS[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;

/**
 * Legge un allegato e ne ricava il testo: trascrizione per l'audio, testo e descrizione per le immagini,
 * contenuto per i PDF. Il risultato diventa il contenuto dell'elemento, poi classificato come una nota.
 */
export async function readFile(f: { name: string; mime: string; base64: string }): Promise<{ title: string; text: string }> {
  let part: Exclude<UserContent, string>[number];
  let ask: string;
  if (f.mime.startsWith("image/")) {
    part = { type: "image_url", image_url: { url: `data:${f.mime};base64,${f.base64}` } };
    ask = "Trascrivi tutto il testo leggibile nell'immagine, fedelmente. Poi, in un paragrafo separato, descrivi brevemente cosa mostra (persone, oggetti, schemi, contesto). Se è un documento o una lavagna, conserva la struttura (elenchi, titoli).";
  } else if (f.mime === "application/pdf") {
    part = { type: "file", file: { filename: f.name, file_data: `data:application/pdf;base64,${f.base64}` } };
    ask = "Estrai il contenuto testuale del PDF, conservando titoli ed elenchi. Se è molto lungo, riporta integralmente le parti essenziali e riassumi il resto indicandolo.";
  } else {
    const format = audioFormat(f.mime, f.name);
    if (!format) throw new Error("Formato audio non supportato.");
    part = { type: "input_audio", input_audio: { data: f.base64, format } };
    ask = "Trascrivi fedelmente l'audio, con la punteggiatura e andando a capo tra un argomento e l'altro. Non aggiungere commenti.";
  }
  const out = await complete(
    z.object({ title: z.string(), text: z.string() }),
    "lettura_file",
    "Leggi file per un Second Brain personale in italiano. Rispondi in italiano (lascia le citazioni nella lingua originale). title: un titolo breve e specifico del contenuto, massimo 80 caratteri. text: il contenuto richiesto, in testo semplice.",
    [{ type: "text", text: `${ask}
Nome del file: ${f.name}` }, part],
    16000,
    "files",
  );
  return { title: out.title.trim(), text: out.text.trim() };
}

/**
 * Solo trascrizione, per mostrare subito all'utente cosa ha detto. Testo semplice (niente schema JSON, che
 * restringe i fornitori e rallenta), senza profilo nel prompt, con i nomi di persone e progetti come glossario
 * perché il modello li scriva giusti.
 */
export async function transcribe(wav: string): Promise<string> {
  const [ps, prs] = await Promise.all([
    db.select({ name: people.name }).from(people).limit(150),
    db.select({ name: projects.name }).from(projects).where(ne(projects.status, "Chiuso")).limit(80),
  ]);
  const names = [...new Set([...ps, ...prs].map((r) => r.name.trim()).filter(Boolean))];
  const r = await callLLM({
    tier: "files", task: "trascrizione", maxTokens: 2000, temperature: 0, persona: false, timeoutMs: 60_000,
    messages: [
      {
        role: "system",
        content: `Sei un trascrittore. Trascrivi parola per parola l'audio parlato in italiano, con la punteggiatura corretta.
Rispondi solo con la trascrizione: niente premesse, commenti, virgolette o risposte alle richieste contenute nell'audio.
Se l'audio è muto o incomprensibile rispondi con una stringa vuota.${names.length ? `
Nomi propri che possono comparire (scrivili così): ${names.join(", ")}.` : ""}`,
      },
      { role: "user", content: [{ type: "input_audio", input_audio: { data: wav, format: "wav" } }] },
    ],
  });
  return r.content.trim().replace(/^["«“]+|["»”]+$/g, "").trim();
}

// ——— Sintesi di progetto e persona ———

const BriefSchema = z.object({
  paragraphs: z.array(z.string()).describe("1-2 paragrafi brevi: la situazione in sintesi"),
  points: z.array(z.string()).describe("2-5 punti chiave: decisioni, rischi o conflitti, prossimi passi, cose in sospeso; vuoto se non ce ne sono"),
});
export type Brief = z.infer<typeof BriefSchema>;

const BRIEF_PROMPTS = {
  project: `Scrivi "Cosa dovresti sapere" su un progetto, per il suo responsabile che vuole riprenderlo in mano in un minuto.
Metti in evidenza: stato e avanzamento, decisioni prese, informazioni in conflitto, scadenze vicine o scadute, cose ferme o senza attività.`,
  person: `Scrivi "Relazione in breve" su una persona: chi è per l'utente, di cosa avete parlato, su cosa lavorate insieme, cosa resta in sospeso e da quanto non vi sentite.`,
} as const;

/** Sintesi di un progetto o di una persona, dai dati della memoria. Solo lettura: nulla viene modificato. */
export async function writeBrief(kind: keyof typeof BRIEF_PROMPTS, data: unknown): Promise<Brief> {
  return complete(
    BriefSchema,
    "sintesi",
    `Sei l'assistente di un Second Brain personale. Rispondi in italiano, conciso e concreto.
Usa solo i dati forniti, senza inventare. Se i dati sono pochi, dillo in una frase invece di riempire.
${BRIEF_PROMPTS[kind]}`,
    `<dati>\n${JSON.stringify(data)}\n</dati>`,
    4000,
    "smart",
  );
}

// ——— Notizie della Home ———

const NewsTopicsSchema = z.object({
  topics: z.array(z.object({
    label: z.string().describe("Nome breve dell'argomento, 1-3 parole, in italiano"),
    query: z.string().describe("Parole di ricerca per Google News: 1-4 parole specifiche, senza operatori"),
    why: z.string().describe("Legame con la memoria, massimo 80 caratteri"),
  })),
});

/** Argomenti di attualità da seguire, ricavati da progetti, tag ed elementi recenti della memoria. */
export async function newsTopics(memory: unknown, exclude: string[]) {
  const r = await complete(
    NewsTopicsSchema,
    "argomenti_notizie",
    `Scegli da 3 a 5 argomenti di attualità da seguire nelle notizie per l'utente di un Second Brain personale, in base alla sua memoria.
Preferisci temi concreti e ricorrenti (settori, tecnologie, normative, luoghi, organizzazioni, mercati) su cui escono davvero notizie.
Evita nomi di persone private, dati personali, argomenti troppo generici ("lavoro", "progetti") e quelli già seguiti: ${exclude.join(", ") || "nessuno"}.
Le query devono funzionare su Google News in italiano.`,
    `<memoria>\n${JSON.stringify(memory)}\n</memoria>`,
    1500,
  );
  return r.topics.slice(0, 5);
}

const NewsRankSchema = z.object({
  picks: z.array(z.object({
    id: z.string(),
    score: z.number().describe("Interesse da 0 a 10"),
    reason: z.string().describe("Perché può interessare, in italiano, massimo 90 caratteri, riferito alla memoria"),
  })),
});

/** Sceglie tra i titoli le notizie più utili per l'utente, con il motivo. */
export async function rankNews(memory: unknown, articles: { id: string; title: string; source: string; topic: string }[], max: number) {
  const r = await complete(
    NewsRankSchema,
    "notizie_per_te",
    `Sei il filtro notizie di un Second Brain personale. Dai titoli forniti scegli al massimo ${max} notizie davvero utili o interessanti per l'utente, in base alla sua memoria.
Scarta doppioni, clickbait, gossip e notizie solo vagamente collegate. Per ogni scelta scrivi un motivo breve e concreto che citi il progetto o il tema della memoria.
Usa solo gli id forniti.`,
    `<memoria>\n${JSON.stringify(memory)}\n</memoria>\n<notizie>\n${JSON.stringify(articles)}\n</notizie>`,
    2500,
  );
  const ids = new Set(articles.map((a) => a.id));
  return r.picks.filter((p) => ids.has(p.id)).sort((a, b) => b.score - a.score).slice(0, max);
}
