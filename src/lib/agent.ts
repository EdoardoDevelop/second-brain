import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { aims, FACT_CATEGORIES, facts as factsTable, itemPeople, items, people, projects, tasks, type FactCategory } from "./db/schema";
import type { ProposedFact } from "./chat";
import { cleanActions, commandActionJsonSchema, FACT_CATEGORY_HELP, type ChatTurn, type CommandAction, type CommandContext } from "./ai";
import { summarizeItems, TOOL_BY_NAME } from "./api-core";
import { isoDay } from "./format";
import { callLLM, type LlmMessage, type LlmTool } from "./llm";
import { commandContext } from "./queries";
import { hybridSearch } from "./semantic";
import { traceRelations } from "./relations";
import type { AiTier } from "./settings";

/**
 * Assistente "a passi": il modello di ragionamento usa gli strumenti di lettura (gli stessi dell'API e dell'MCP)
 * per cercare, aprire e confrontare quello che serve, poi risponde citando le fonti. Le modifiche non le esegue:
 * le propone (propose_actions) come schede da confermare, e propone i fatti da ricordare (remember_fact).
 */

export type AgentEvent =
  | { type: "tool"; label: string }
  | { type: "delta"; text: string }
  /** Il testo mostrato finora era un preambolo prima di usare gli strumenti: va tolto. */
  | { type: "reset" };

export type AgentResult = {
  text: string;
  note: string;
  /** Elementi citati (inline o in FONTI) e comunque letti. */
  sources: string[];
  read: number;
  followUps: string[];
  actions: CommandAction[];
  names: Record<string, string>;
  facts: ProposedFact[];
  steps: string[];
  model: string;
  tier: AiTier;
  cost: number;
  /** Modalità diario: l'Assistente ha chiuso la conversazione ([[FINE]]). */
  done: boolean;
};

/** Modalità diario («Com'è andata oggi?»): perché ha scritto, cosa vuole scoprire, quante domande ha già fatto. */
export type CheckinContext = { reason: string[]; goal: string; asked: number };

const READ_TOOLS = ["today", "get_item", "recent_items", "list_tasks", "list_projects", "get_project", "list_people", "get_person"] as const;
// Il contesto di base è già nel prompt: bastano pochi passi (ognuno è una chiamata al modello).
const MAX_STEPS = 5;
const MAX_TOOL_CHARS = 14000;

function toolDefs(): LlmTool[] {
  const defs: LlmTool[] = READ_TOOLS.map((n) => {
    const t = TOOL_BY_NAME.get(n)!;
    return { type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } };
  });
  defs.unshift({
    type: "function",
    function: {
      name: "search_memory",
      description: "Cerca nella memoria per parole e per significato (trova anche testi con parole diverse). Restituisce titolo, tipo, data, sintesi, tag, progetto e persone di ogni risultato. Poi apri con get_item quelli utili. Fai più ricerche con parole diverse se la prima non basta.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Cosa cercare, in parole naturali" }, limit: { type: "number", description: "Massimo risultati (predefinito 10)" } }, required: ["query"] },
    },
  });
  defs.push({
    type: "function",
    function: {
      name: "trace_relations",
      description: "Segue in una sola chiamata i collegamenti attorno a un progetto, una persona o un obiettivo personale: attività aperte (scadute, ferme, da chi dipendono), persone coinvolte e da quanto non se ne sa nulla, ultime riunioni e note, documenti, decisioni, conflitti, più le prove già misurate. Usalo per domande sul perché e sul come («perché X è fermo?», «cosa blocca…?», «chi sto aspettando per…?», «com'è messo…?»).",
      parameters: { type: "object", properties: { id: { type: "string", description: "id del progetto, della persona o dell'obiettivo, se lo conosci" }, name: { type: "string", description: "Altrimenti il nome" } } },
    },
  });
  defs.push({
    type: "function",
    function: {
      name: "propose_actions",
      description: "Propone modifiche alla memoria (catture, attività, progetti, obiettivi, persone, modifiche e collegamenti tra elementi). NON le esegue: l'utente le vede come schede e le conferma. Usa solo id ottenuti dagli strumenti. Per informazioni nuove da archiviare usa kind capture.",
      parameters: commandActionJsonSchema(),
    },
  });
  defs.push({
    type: "function",
    function: {
      name: "remember_fact",
      description: "Propone di ricordare un fatto stabile sull'utente (lavoro, persone ricorrenti, preferenze, abitudini) che gli sarà utile in futuro. L'utente lo conferma. Solo per informazioni dette dall'utente stesso e durature, mai per cose già note.",
      parameters: {
        type: "object",
        properties: {
          fact: { type: "string", description: "Il fatto, in terza persona, breve (es. «Lavora come geometra a Milano»)" },
          replaces: { type: "array", items: { type: "string" }, description: "Testo esatto dei fatti già confermati che questo rende non più veri (es. il lavoro precedente); vuoto se nessuno" },
          category: { type: "string", enum: [...FACT_CATEGORIES], description: FACT_CATEGORY_HELP },
          valid_from: { type: "string", description: "Da quando vale, YYYY-MM-DD, se l'utente lo dice (anche nel futuro: «dal 19 ottobre» → 2026-10-19; «da lunedì»); null se non lo dice" },
        },
        required: ["fact"],
      },
    },
  });
  return defs;
}

/** Etichetta leggibile di un passo (mostrata mentre l'Assistente lavora). */
function stepLabel(name: string, args: Record<string, unknown>, titles: Map<string, string>): string {
  const q = (k: string) => String(args[k] ?? "").slice(0, 60);
  switch (name) {
    case "search_memory": return `Cerco «${q("query")}»`;
    case "get_item": return `Leggo «${titles.get(String(args.id)) ?? "un elemento"}»`;
    case "today": return "Guardo la giornata";
    case "recent_items": return "Guardo gli elementi recenti";
    case "list_tasks": return "Guardo le attività";
    case "list_projects": return "Guardo i progetti";
    case "get_project": return `Apro il progetto «${titles.get(String(args.id)) ?? ""}»`;
    case "list_people": return "Guardo le persone";
    case "get_person": return `Apro la scheda di ${titles.get(String(args.id)) ?? "una persona"}`;
    case "trace_relations": return `Seguo i collegamenti di «${titles.get(String(args.id)) ?? (q("name") || "…")}»`;
    case "propose_actions": return "Preparo le azioni da confermare";
    case "remember_fact": return "Propongo qualcosa da ricordare";
    default: return name;
  }
}

async function scopeInfo(scope: string): Promise<{ label: string; within?: Set<string> }> {
  const [kind, ref] = scope.split(":");
  if (kind === "recent") {
    const since = Date.now() - 30 * 86400000;
    const rows = await db.select({ id: items.id, at: items.createdAt }).from(items).where(eq(items.status, "memory"));
    return { label: "ultimi 30 giorni", within: new Set(rows.filter((r) => r.at.getTime() >= since).map((r) => r.id)) };
  }
  if (kind === "project" && ref) {
    const [p] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, ref));
    const rows = await db.select({ id: items.id }).from(items).where(and(eq(items.status, "memory"), eq(items.projectId, ref)));
    return { label: `progetto «${p?.name ?? ""}» (id ${ref})`, within: new Set(rows.map((r) => r.id)) };
  }
  if (kind === "person" && ref) {
    const [p] = await db.select({ name: people.name }).from(people).where(eq(people.id, ref));
    const rows = await db.select({ id: itemPeople.itemId }).from(itemPeople).where(eq(itemPeople.personId, ref));
    return { label: `persona «${p?.name ?? ""}» (id ${ref})`, within: new Set(rows.map((r) => r.id)) };
  }
  return { label: "tutta la memoria" };
}

/** Descrizione della pagina da cui arriva la domanda (focus = item:<id> | project:<id> | person:<id>). */
async function focusInfo(focus?: string): Promise<string> {
  if (!focus) return "";
  const [kind, id] = focus.split(":");
  if (kind === "item" && id) {
    const [i] = await db.select({ title: items.title, type: items.type }).from(items).where(eq(items.id, id));
    return i ? `L'utente sta guardando l'elemento «${i.title}» (${i.type ?? "Nota"}, id ${id}): se la domanda è vaga, si riferisce a questo. Aprilo con get_item.` : "";
  }
  if (kind === "project" && id) return `L'utente sta guardando il progetto con id ${id}: aprilo con get_project se serve.`;
  if (kind === "person" && id) return `L'utente sta guardando la persona con id ${id}: aprila con get_person se serve.`;
  return "";
}

/** Quadro di partenza nel prompt (progetti, persone, attività aperte, elementi recenti): evita i passi di sola lettura. */
async function basics(titles: Map<string, string>): Promise<string> {
  const [ps, pp, ts, its, as] = await Promise.all([
    db.select({ id: projects.id, name: projects.name, status: projects.status, next: projects.next }).from(projects),
    db.select({ id: people.id, name: people.name, role: people.role, org: people.org }).from(people),
    db.select({ id: tasks.id, title: tasks.title, due: tasks.due, projectId: tasks.projectId }).from(tasks).where(eq(tasks.done, false)).limit(80),
    db.select({ id: items.id, type: items.type, title: items.title, summary: items.summary, createdAt: items.createdAt }).from(items).where(eq(items.status, "memory")).orderBy(desc(items.createdAt)).limit(30),
    db.select({ id: aims.id, title: aims.title, status: aims.status, due: aims.due }).from(aims).where(inArray(aims.status, ["active", "paused"])),
  ]);
  for (const x of as) titles.set(x.id, x.title);
  for (const x of ps) titles.set(x.id, x.name);
  for (const x of pp) titles.set(x.id, x.name);
  for (const x of its) titles.set(x.id, x.title);
  return JSON.stringify({
    progetti: ps, persone: pp, attivita_aperte: ts, obiettivi_personali: as,
    elementi_recenti: its.map((i) => ({ id: i.id, tipo: i.type, titolo: i.title, sintesi: (i.summary ?? "").slice(0, 220), data: isoDay(i.createdAt) })),
  });
}

/** Prompt della conversazione serale: un amico che fa poche domande, non un assistente che risponde. */
function checkinPrompt(o: { today: string; weekday: string; basics: string; checkin: CheckinContext }) {
  const left = Math.max(0, 3 - o.checkin.asked);
  return `Sei il Second Brain dell'utente e stasera state facendo due chiacchiere su com'è andata la giornata, come tra amici. Oggi è ${o.weekday} ${o.today}. Scrivi in italiano, con il tono del suo profilo.
Perché gli hai scritto: ${o.checkin.reason.join("; ") || "per sapere com'è andata"}.
Cosa vale la pena scoprire (per la sua memoria): ${o.checkin.goal || "come è andata e le novità importanti"}.

Come parli:
- Una sola domanda per messaggio, breve (1-2 frasi), calda e naturale, niente elenchi, niente grassetto, niente citazioni né marcatori [[FONTI]], [[NOTA]] o [[DOMANDE]].
- Reagisci prima a quello che ha detto (una frase), poi fai la domanda. Chiedi ciò che la memoria non sa ancora: nomi e ruoli delle persone nuove, impressioni, cosa succede dopo. Se ti serve sapere se una persona o una cosa è già nota, usa gli strumenti di lettura; non chiedere quello che sai.
- ${left > 0 ? `Puoi fare ancora al massimo ${left} ${left === 1 ? "domanda" : "domande"}.` : "Hai già fatto abbastanza domande: chiudi adesso."} Chiudi prima se risponde a monosillabi, è stanco o vuole smettere.
- Per chiudere: una frase di saluto affettuosa (senza domande), poi su una riga a parte [[FINE]]. Non proporre azioni né fatti da ricordare: li ricaverai dopo.

<quadro_di_partenza>
${o.basics}
</quadro_di_partenza>`;
}

function systemPrompt(o: { today: string; weekday: string; scope: string; focus: string; mode: "chat" | "command"; basics: string }) {
  return `Sei l'Assistente del Second Brain personale dell'utente: la sua memoria di note, documenti, decisioni, riunioni, progetti, persone, attività e obiettivi. Rispondi in italiano.
Oggi è ${o.weekday} ${o.today}. Ambito delle ricerche: ${o.scope}.${o.focus ? "\n" + o.focus : ""}

Come lavori:
- Sotto trovi già progetti, persone, attività aperte ed elementi recenti con la sintesi: se bastano, rispondi subito, senza strumenti.
- Per domande sul perché o sul come di un progetto, una persona o un obiettivo («perché X è fermo?», «cosa blocca…?», «chi sto aspettando?») usa per prima cosa trace_relations: in una chiamata ti dà il percorso attività → persone → conversazioni → documenti con le prove. Rispondi seguendo quel percorso, con le prove concrete (giorni, attività, persone) e le citazioni.
- Altrimenti cerca con search_memory e apri con get_item solo gli elementi di cui ti serve il testo completo. Sii rapido: chiama più strumenti nello stesso passo (più ricerche o più get_item insieme) invece che uno alla volta. Per la giornata usa today.
- Non inventare: usa solo ciò che trovi. Se le informazioni mancano o si contraddicono, dillo (indica la più recente).
- Non scrivere nulla prima di aver usato gli strumenti necessari: niente "Ora cerco…".
- Richieste di modifica (aggiungere, completare, spostare, collegare, archiviare, ricordare di…, "segna che…") → propose_actions con le azioni. Non dire mai che le hai eseguite: l'utente le conferma. Date relative convertite in YYYY-MM-DD rispetto a oggi; il nome di un giorno indica la sua prossima occorrenza dopo oggi.
- Quando l'utente racconta qualcosa di stabile su di sé (ruolo, lavoro, persone della sua vita e chi sono per lui, preferenze, abitudini) proponi remember_fact, un fatto per chiamata. Non per cose passeggere né già note.
${o.mode === "command" ? "- Questa richiesta arriva dalla barra comandi: preferisci proporre azioni; rispondi a parole solo se è una domanda.\n" : ""}
Formato della risposta:
- Diretta e concisa: 1-3 paragrafi brevi separati da una riga vuota; per passi o punti un elenco con righe che iniziano con "- ". **Grassetto** per le parole chiave. Niente titoli.
- Cita le fonti nel testo con ⟦id⟧ subito dopo l'informazione (id dell'elemento letto), es. "La riunione ha fissato il budget a 20k ⟦it_ab12⟧."
- Se hai proposto azioni, scrivi solo una frase che le riassuma.
- Alla fine, su righe separate:
[[FONTI: id1, id2]] con gli id degli elementi che hai usato (vuoto se nessuno)
[[NOTA: …]] solo se mancano informazioni o sono in conflitto
[[DOMANDE: domanda 1 | domanda 2 | domanda 3]] 2-3 domande brevi che l'utente potrebbe farti dopo, utili e specifiche

<quadro_di_partenza>
${o.basics}
</quadro_di_partenza>`;
}

const CITE = /⟦\s*([A-Za-z0-9_-]+)\s*⟧/g;

/** Esegue l'Assistente: passi con gli strumenti, poi risposta (in streaming con `onEvent`). */
export async function runAgent(o: {
  question: string;
  turns?: ChatTurn[];
  scope?: string;
  focus?: string;
  tier?: AiTier;
  mode?: "chat" | "command" | "checkin";
  checkin?: CheckinContext;
  model?: string;
  /** Nome del compito nel registro dei consumi (predefinito "assistente"). */
  task?: string;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
}): Promise<AgentResult> {
  const emit = o.onEvent ?? (() => {});
  const tier = o.tier ?? "smart";
  const scope = await scopeInfo(o.scope ?? "all");
  const weekday = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long" }).format(new Date());
  const titles = new Map<string, string>();
  const messages: LlmMessage[] = [
    {
      role: "system",
      content: o.mode === "checkin" && o.checkin
        ? checkinPrompt({ today: isoDay(), weekday, basics: await basics(titles), checkin: o.checkin })
        : systemPrompt({ today: isoDay(), weekday, scope: scope.label, focus: await focusInfo(o.focus), mode: o.mode === "command" ? "command" : "chat", basics: await basics(titles) }),
    },
    ...(o.turns ?? []).slice(-8).map((t): LlmMessage => ({ role: t.role, content: t.text })),
    { role: "user", content: o.question },
  ];
  // Nel diario solo lettura: azioni e fatti si ricavano alla fine della conversazione.
  const tools = o.mode === "checkin" ? toolDefs().filter((t) => t.function.name !== "propose_actions" && t.function.name !== "remember_fact") : toolDefs();
  const read = new Set<string>();
  const steps: string[] = [];
  const proposed: unknown[] = [];
  const facts: { text: string; replaces: string[]; category: FactCategory | null; validFrom: string | null }[] = [];
  let cost = 0;
  let model = "";
  let usedTier: AiTier = tier;
  let final = "";

  for (let step = 0; step <= MAX_STEPS; step++) {
    let shown = false;
    let buf = "";
    let sent = 0;
    const last = step === MAX_STEPS;
    const r = await callLLM({
      tier, task: o.task ?? "assistente", model: o.model, messages, maxTokens: 3000, signal: o.signal,
      ...(last ? {} : { tools }),
      // Si mostra il testo fino al primo marcatore finale; una "[" in coda potrebbe esserne l'inizio e si trattiene.
      onDelta: (d) => {
        buf += d;
        const c = buf.indexOf("[[");
        const end = c >= 0 ? c : buf.endsWith("[") ? buf.length - 1 : buf.length;
        if (end > sent) { shown = true; emit({ type: "delta", text: buf.slice(sent, end) }); sent = end; }
      },
    });
    cost += r.cost;
    model = r.model;
    usedTier = r.tier;
    if (!r.toolCalls.length) { final = r.content; break; }
    if (shown) emit({ type: "reset" });

    messages.push({ role: "assistant", content: r.content || null, tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) });
    for (const c of r.toolCalls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.arguments || "{}"); } catch { /* argomenti non validi */ }
      const label = stepLabel(c.name, args, titles);
      steps.push(label);
      emit({ type: "tool", label });
      let out: unknown;
      try {
        out = await runTool(c.name, args, { scope, read, titles, proposed, facts });
      } catch (e) {
        out = { error: e instanceof Error ? e.message : "Errore" };
      }
      let text = JSON.stringify(out);
      if (text.length > MAX_TOOL_CHARS) text = text.slice(0, MAX_TOOL_CHARS) + "…(troncato)";
      messages.push({ role: "tool", tool_call_id: c.id, content: text });
    }
  }

  // Marcatori finali e citazioni.
  const cut = final.indexOf("[[");
  let text = (cut >= 0 ? final.slice(0, cut) : final).trim();
  const listed = (final.match(/\[\[\s*FONTI\s*:([^\]]*)\]\]/i)?.[1] ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const cited = [...text.matchAll(CITE)].map((m) => m[1]);
  const known = new Set([...read, ...titles.keys()]);
  // Citazioni di id mai visti: tolte dal testo.
  text = text.replace(CITE, (m, id: string) => (read.has(id) || known.has(id) ? m : "")).replace(/ +([.,;:])/g, "$1");
  const sources = [...new Set([...cited, ...listed])].filter((id) => read.has(id) || (known.has(id) && id.startsWith("it_")));
  const note = final.match(/\[\[\s*NOTA\s*:([^\]]*)\]\]/i)?.[1]?.trim() ?? "";
  const followUps = (final.match(/\[\[\s*DOMANDE\s*:([^\]]*)\]\]/i)?.[1] ?? "").split("|").map((x) => x.trim()).filter((x) => x.length > 3).slice(0, 3);

  // Azioni: validate sugli id esistenti (più quelli letti durante la ricerca, anche se vecchi).
  let actions: CommandAction[] = [];
  let names: Record<string, string> = {};
  if (proposed.length) {
    const ctx: CommandContext = await commandContext();
    const extra = [...read].filter((id) => !ctx.items.some((i) => i.id === id));
    if (extra.length) {
      const rows = await db.select({ id: items.id, type: items.type, title: items.title, tags: items.tags, createdAt: items.createdAt }).from(items).where(inArray(items.id, extra));
      ctx.items.push(...rows.map(({ createdAt, ...i }) => ({ ...i, date: isoDay(createdAt) })));
    }
    actions = cleanActions(proposed, ctx);
    names = Object.fromEntries([
      ...[...ctx.projects, ...ctx.people].map((x) => [x.id, x.name]),
      ...[...ctx.tasks, ...ctx.items, ...ctx.goals, ...ctx.aims].map((x) => [x.id, x.title]),
    ]);
  }

  // Fatti proposti: i «sostituisce» indicati a parole si risolvono sui fatti confermati.
  let proposedFacts: ProposedFact[] = [];
  if (facts.length) {
    const known = await db.select({ id: factsTable.id, text: factsTable.text }).from(factsTable).where(eq(factsTable.status, "confirmed"));
    const norm = (x: string) => x.toLowerCase().replace(/[«»"'.]/g, "").replace(/\s+/g, " ").trim();
    const find = (x: string) => known.find((k) => norm(k.text) === norm(x)) ?? known.find((k) => norm(k.text).includes(norm(x)) || norm(x).includes(norm(k.text)));
    const seen = new Set<string>();
    proposedFacts = facts.filter((f) => !seen.has(f.text.toLowerCase()) && seen.add(f.text.toLowerCase()) && !known.some((k) => norm(k.text) === norm(f.text)))
      .map((f) => ({ text: f.text, category: f.category, validFrom: f.validFrom, replaces: [...new Map(f.replaces.map(find).filter((k): k is { id: string; text: string } => !!k).map((k) => [k.id, k])).values()] }));
  }

  const done = /\[\[\s*FINE\s*\]\]/i.test(final);
  return { text, note, sources, read: read.size, followUps, actions, names, facts: proposedFacts, steps, model, tier: usedTier, cost, done };
}

type ToolState = { scope: { within?: Set<string> }; read: Set<string>; titles: Map<string, string>; proposed: unknown[]; facts: { text: string; replaces: string[]; category: FactCategory | null; validFrom: string | null }[] };

async function runTool(name: string, args: Record<string, unknown>, st: ToolState): Promise<unknown> {
  if (name === "search_memory") {
    const q = String(args.query ?? "").trim();
    if (!q) return { results: [] };
    const limit = Math.max(1, Math.min(25, Number(args.limit ?? 10) || 10));
    const ids = await hybridSearch(q, limit, st.scope.within);
    if (!ids.length) return { results: [], hint: "Nessun risultato: prova con parole diverse o più generali." };
    const rows = await db.select().from(items).where(inArray(items.id, ids));
    const order = new Map(ids.map((id, i) => [id, i]));
    const res = await summarizeItems(rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!));
    for (const r of res) st.titles.set(r.id, r.title);
    return { results: res };
  }
  if (name === "trace_relations") {
    const out = await traceRelations({ id: args.id ? String(args.id) : undefined, name: args.name ? String(args.name) : undefined });
    // Gli elementi restituiti valgono come letti: si possono citare.
    if (out.subject) {
      st.titles.set(out.subject.id, out.subject.name);
      for (const i of [...(out.conversations ?? []), ...(out.documents ?? []), ...(out.decisions ?? [])]) { st.read.add(i.id); st.titles.set(i.id, i.title); }
      for (const e of out.evidence ?? []) if (e.id) st.read.add(e.id);
      for (const t of out.openTasks ?? []) if (t.fromItem) { st.read.add(t.fromItem.id); st.titles.set(t.fromItem.id, t.fromItem.title); }
    }
    return out;
  }
  if (name === "propose_actions") {
    const list = Array.isArray(args.actions) ? args.actions : [];
    st.proposed.push(...list);
    return { ok: true, message: `${list.length} azioni proposte all'utente, che le confermerà. Non dire che sono state eseguite.` };
  }
  if (name === "remember_fact") {
    const f = String(args.fact ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const replaces = Array.isArray(args.replaces) ? args.replaces.map((x) => String(x).trim()).filter(Boolean).slice(0, 4) : [];
    const category = (FACT_CATEGORIES as readonly string[]).includes(String(args.category)) ? (args.category as FactCategory) : null;
    const vf = String(args.valid_from ?? "");
    if (f) st.facts.push({ text: f, replaces, category, validFrom: /^\d{4}-\d{2}-\d{2}$/.test(vf) ? vf : null });
    return { ok: true, message: "Proposto all'utente, che deciderà se ricordarlo." };
  }
  const tool = TOOL_BY_NAME.get(name);
  if (!tool || !(READ_TOOLS as readonly string[]).includes(name)) return { error: `Strumento non disponibile: ${name}` };
  const out = await tool.run(args);
  if (name === "get_item") {
    const o = out as { id: string; title: string };
    st.read.add(o.id);
    st.titles.set(o.id, o.title);
  }
  // Titoli per le etichette dei passi successivi.
  const collect = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") {
      const x = v as Record<string, unknown>;
      if (typeof x.id === "string" && (typeof x.title === "string" || typeof x.name === "string")) st.titles.set(x.id, String(x.title ?? x.name));
      Object.values(x).forEach((y) => typeof y === "object" && collect(y));
    }
  };
  collect(out);
  return out;
}
