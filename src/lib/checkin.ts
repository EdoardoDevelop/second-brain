import "server-only";
import { z } from "zod";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db, newId } from "./db";
import { aims, chats, checkins, facts, itemPeople, items, people, projects, tasks, type CheckinEvent } from "./db/schema";
import type { ChatMsg, ProposedFact } from "./chat";
import type { CommandAction } from "./ai";
import { isoDay } from "./format";
import { budgetState, callJSON } from "./llm";
import { log } from "./pipeline";
import { sendPush } from "./push";
import { getSetting, setSetting } from "./settings";

/**
 * «Com'è andata oggi?» — la sera l'Assistente scrive come un amico, solo quando ha senso.
 * 1. Il codice (checkinTick, dal pianificatore) calcola gli eventi salienti di oggi e decide se scrivere.
 * 2. L'IA scrive la prima domanda sapendo cosa conosce già; notifica + riquadro nella Home.
 * 3. La conversazione (modalità «diario» dell'Assistente, 2-3 domande) va sui buchi della memoria.
 * 4. Alla fine l'IA ricava nota di diario, persone, fatti e attività: tutto da confermare (regola centrale).
 */

export type CheckinPrefs = {
  enabled: boolean;
  /** Fascia oraria (HH:MM, ora italiana). */
  from: string; to: string;
  /** Nel weekend: sempre, solo con un evento vero, mai. */
  weekend: "always" | "events" | "never";
  /** Check-in generici («Giornata tranquilla?») a settimana nei giorni senza eventi. */
  generic: number;
};
export const DEFAULT_CHECKIN: CheckinPrefs = { enabled: true, from: "18:30", to: "20:00", weekend: "events", generic: 2 };
const EVENT_THRESHOLD = 5;
const DAY = 86400000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function getCheckinPrefs(): Promise<CheckinPrefs> {
  try {
    const p = { ...DEFAULT_CHECKIN, ...JSON.parse((await getSetting("checkin_prefs")) ?? "{}") } as CheckinPrefs;
    return {
      enabled: p.enabled !== false,
      from: HHMM.test(p.from) ? p.from : DEFAULT_CHECKIN.from,
      to: HHMM.test(p.to) && p.to > p.from ? p.to : DEFAULT_CHECKIN.to,
      weekend: ["always", "events", "never"].includes(p.weekend) ? p.weekend : "events",
      generic: Math.max(0, Math.min(5, Math.round(Number(p.generic) || 0))),
    };
  } catch { return DEFAULT_CHECKIN; }
}

const romeTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const romeWeekday = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", weekday: "short" }).format(new Date());
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Parole che nei titoli di oggi indicano una giornata particolare. */
const SPECIAL = /\b(primo giorno|colloquio|esame|visita|medico|dentista|ospedale|partenza|viaggio|volo|trasloco|presentazione|consegna|scadenza|appuntamento|compleanno|festa|matrimonio|laurea|inaugurazione|lancio|firma|contratto|intervento|gara|concerto)\b/i;

/** Gli eventi salienti di oggi, con un punteggio: solo dati, niente IA. */
export async function dayEvents(): Promise<CheckinEvent[]> {
  const today = isoDay();
  const start = new Date(Date.parse(today + "T00:00:00") - 2 * 3600000); // margine per il fuso
  const [fs, ts, its, as, ip, pp, ps] = await Promise.all([
    db.select().from(facts).where(eq(facts.status, "confirmed")),
    db.select().from(tasks),
    db.select().from(items).where(and(eq(items.status, "memory"), gte(items.createdAt, start))),
    db.select().from(aims),
    db.select().from(itemPeople),
    db.select({ id: people.id, name: people.name }).from(people),
    db.select({ id: projects.id, name: projects.name }).from(projects),
  ]);
  const ev: CheckinEvent[] = [];
  for (const f of fs) if (f.validFrom === today && isoDay(f.createdAt) !== today) ev.push({ kind: "fact_starts", score: 10, text: `Da oggi: ${f.text}` });
  const todays = its.filter((i) => isoDay(i.createdAt) === today);
  const todayIds = new Set(todays.map((i) => i.id));
  const personName = new Map(pp.map((p) => [p.id, p.name]));
  const projectName = new Map(ps.map((p) => [p.id, p.name]));
  const peopleOf = (itemId: string | null) => (itemId ? ip.filter((x) => x.itemId === itemId).map((x) => personName.get(x.personId)).filter(Boolean) as string[] : []);
  for (const t of ts.filter((x) => x.due === today)) {
    const who = peopleOf(t.sourceItemId);
    const special = SPECIAL.test(t.title);
    if (t.time || special || who.length) {
      ev.push({ kind: "task_today", score: 5 + (special ? 2 : 0) + (who.length ? 2 : 0), text: `Oggi${t.time ? ` alle ${t.time}` : ""}: «${t.title}»${who.length ? ` con ${who.join(", ")}` : ""}${t.projectId ? ` (${projectName.get(t.projectId) ?? "progetto"})` : ""}${t.done ? ", fatta" : ""}` });
    }
  }
  for (const a of as) {
    if (a.due === today && a.status === "active") ev.push({ kind: "aim_due", score: 7, text: `Oggi scadeva l'obiettivo «${a.title}»` });
    if (a.doneAt && isoDay(a.doneAt) === today) ev.push({ kind: "aim_done", score: 8, text: `Oggi hai raggiunto l'obiettivo «${a.title}»` });
  }
  for (const i of todays.filter((x) => x.type === "Riunione" || x.type === "Decisione" || SPECIAL.test(x.title)).slice(0, 3)) {
    ev.push({ kind: "item_today", score: SPECIAL.test(i.title) ? 6 : 3, text: `${i.type ?? "Nota"} di oggi: «${i.title}»${peopleOf(i.id).length ? ` (con ${peopleOf(i.id).join(", ")})` : ""}` });
  }
  // Persone comparse oggi per la prima volta nella memoria.
  const firstSeen = new Map<string, boolean>();
  for (const x of ip) {
    const isToday = todayIds.has(x.itemId);
    firstSeen.set(x.personId, (firstSeen.get(x.personId) ?? true) && isToday);
  }
  for (const [pid, onlyToday] of firstSeen) if (onlyToday) ev.push({ kind: "new_person", score: 4, text: `Hai conosciuto (o nominato per la prima volta) ${personName.get(pid)}` });
  return ev.sort((a, b) => b.score - a.score).slice(0, 6);
}

const OpeningSchema = z.object({
  message: z.string().describe("Il primo messaggio della sera, come un amico: 1-2 frasi brevi e calde, termina con una domanda aperta. Cita l'evento concreto. Niente saluti formali, niente elenchi."),
  goal: z.string().describe("Cosa vale la pena scoprire in questa conversazione, per la memoria (es. «come è andato il primo giorno, chi sono i nuovi colleghi e che ruolo hanno»)"),
  followUps: z.array(z.string()).describe("2-3 possibili domande successive, mirate a ciò che la memoria non sa ancora"),
});

/** Dal pianificatore (ogni minuto): nella fascia serale decide se scrivere e, se sì, prepara la conversazione e la notifica. */
export async function checkinTick() {
  const prefs = await getCheckinPrefs();
  if (!prefs.enabled) return;
  const today = isoDay();
  const now = romeTime();
  if (now < prefs.from || now > prefs.to) return;
  const [row] = await db.select({ id: checkins.id }).from(checkins).where(eq(checkins.day, today));
  if (row) return;

  // Ieri scritto e mai risposto → ignorato (serve a imparare la frequenza).
  await db.update(checkins).set({ status: "ignored" }).where(and(eq(checkins.status, "sent"), lt(checkins.day, today)));
  const recent = await db.select().from(checkins).where(gte(checkins.day, isoDay(new Date(Date.now() - 30 * DAY)))).orderBy(desc(checkins.day));

  // Ora d'invio: quella a cui di solito risponde (mediana delle ultime risposte), dentro la fascia.
  const answeredAt = recent.filter((c) => c.answeredAt).map((c) => toMin(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(c.answeredAt!))).sort((a, b) => a - b);
  const sendAt = answeredAt.length >= 3 ? fromMin(Math.max(toMin(prefs.from), Math.min(toMin(prefs.to) - 15, answeredAt[Math.floor(answeredAt.length / 2)] - 15))) : prefs.from;
  if (now < sendAt) return;

  const insert = (values: Partial<typeof checkins.$inferInsert>) => db.insert(checkins).values({ id: newId("ck"), day: today, status: "skipped", events: [], ...values });
  const budget = await budgetState();
  if (budget.near) { await insert({ status: "skipped", events: [{ kind: "budget", score: 0, text: "Vicino al tetto di spesa" }] }); return; }

  const events = await dayEvents();
  const best = events[0]?.score ?? 0;
  const weekend = ["Sat", "Sun"].includes(romeWeekday());
  const hasEvent = best >= EVENT_THRESHOLD;
  // Generici: pochi a settimana, mai due giorni di fila, sospesi se gli ultimi 3 check-in sono stati ignorati.
  const lastThree = recent.filter((c) => c.status !== "skipped").slice(0, 3);
  const ignoredStreak = lastThree.length === 3 && lastThree.every((c) => c.status === "ignored");
  const genericWeek = recent.filter((c) => c.generic && c.status !== "skipped" && c.day >= isoDay(new Date(Date.now() - 7 * DAY))).length;
  const yesterdaySent = recent.some((c) => c.day === isoDay(new Date(Date.now() - DAY)) && c.status !== "skipped");
  const allowGeneric = prefs.generic > 0 && genericWeek < prefs.generic && !yesterdaySent && !ignoredStreak && !weekend;
  const go = (weekend && prefs.weekend === "never") ? false : hasEvent || allowGeneric;
  if (!go) { await insert({ status: "skipped", events }); return; }

  try {
    const out = await callJSON<z.infer<typeof OpeningSchema>>({
      tier: "smart", task: "com_e_andata", name: "checkin_apertura", maxTokens: 600,
      messages: [
        {
          role: "system",
          content: `Sei il Second Brain dell'utente e stasera gli scrivi come un amico che lo conosce bene, per sapere com'è andata la giornata. Scrivi in italiano, con il tono del suo profilo. ${hasEvent ? "Parti dall'evento più importante di oggi e chiedi com'è andato." : "Oggi non è successo niente di speciale in memoria: una domanda leggera e aperta sulla giornata, senza inventare eventi."} Non chiedere cose che sai già (fatti, persone e progetti che conosci sono nel contesto). Pensa a cosa manca alla memoria (persone nuove senza nome o ruolo, impressioni, prossimi passi) per le domande successive.`,
        },
        { role: "user", content: `<oggi>${today}</oggi>\n<eventi_di_oggi>\n${events.length ? events.map((e) => "- " + e.text).join("\n") : "nessuno"}\n</eventi_di_oggi>` },
      ],
      jsonSchema: z.toJSONSchema(OpeningSchema),
      parse: (v) => OpeningSchema.safeParse(v) as { success: true; data: z.infer<typeof OpeningSchema> } | { success: false },
    });
    const id = newId("ck");
    const chatId = newId("ch");
    const why = hasEvent ? `Ti scrivo perché: ${events.filter((e) => e.score >= EVENT_THRESHOLD).slice(0, 2).map((e) => e.text).join("; ")}.` : "Ti scrivo solo per sapere com'è andata: in memoria oggi non c'è niente di particolare.";
    const opening: ChatMsg = {
      role: "assistant", answer: { text: out.message.trim(), note: why, sources: [], read: 0 },
      cards: [], names: {}, cmd: "review", doneCount: 0, scope: "diario",
    };
    const d = today.slice(8, 10) + "/" + today.slice(5, 7);
    const now2 = new Date();
    await db.insert(chats).values({ id: chatId, title: `Diario ${d}${hasEvent ? ": " + events[0].text.replace(/^Da oggi: |^Oggi[^:]*: /, "").slice(0, 60) : ""}`, scope: `diary:${id}`, msgs: JSON.stringify([opening]), createdAt: now2, updatedAt: now2 });
    await db.insert(checkins).values({ id, day: today, status: "sent", events, generic: !hasEvent, opening: out.message.trim(), goal: [out.goal, ...out.followUps.map((q) => "possibile domanda: " + q)].join("\n"), chatId, sentAt: now2 });
    await sendPush({ title: "Com'è andata oggi?", body: out.message.trim(), url: `/assistente?chat=${chatId}`, tag: "checkin" }).catch(() => 0);
    await log("Com'è andata oggi?", null, `${hasEvent ? "evento: " + events[0].text : "check-in generico"}`);
  } catch (e) {
    await insert({ status: "skipped", events: [...events, { kind: "error", score: 0, text: e instanceof Error ? e.message : "Errore" }] });
  }
}

/** Il check-in di oggi ancora senza risposta (per il riquadro della Home). */
export async function todayCheckin(): Promise<{ chatId: string; message: string } | null> {
  const [c] = await db.select().from(checkins).where(and(eq(checkins.day, isoDay()), eq(checkins.status, "sent")));
  return c?.chatId && c.opening ? { chatId: c.chatId, message: c.opening } : null;
}

export async function getCheckin(id: string) {
  const [c] = await db.select().from(checkins).where(eq(checkins.id, id));
  return c ?? null;
}

export async function markAnswered(id: string) {
  await db.update(checkins).set({ status: "answered", answeredAt: new Date() }).where(and(eq(checkins.id, id), eq(checkins.status, "sent")));
}

// ——— Cosa ricavare dalla conversazione ———

const ExtractSchema = z.object({
  diary: z.object({
    title: z.string().describe("Titolo della nota di diario, breve (es. «Primo giorno in Easytech»)"),
    summary: z.string().describe("Sintesi in una o due frasi"),
    text: z.string().describe("Il racconto della giornata in prima persona, come lo scriverebbe l'utente nel suo diario: fatti, impressioni, persone. Solo ciò che ha detto."),
    tags: z.array(z.string()).describe("1-4 tag senza #"),
  }),
  people: z.array(z.object({
    personId: z.string().nullable().describe("id di una persona già nota, se è lei; altrimenti null"),
    name: z.string().describe("Nome e cognome come detti dall'utente"),
    role: z.string().nullable(), org: z.string().nullable(),
    note: z.string().nullable().describe("Chi è per l'utente, in breve (es. «collega in Easytech, conosciuto il primo giorno; molto disponibile»)"),
  })).describe("Persone nominate nella conversazione, con quello che l'utente ne ha detto. Vuoto se nessuna."),
  facts: z.array(z.object({
    text: z.string().describe("Fatto stabile sull'utente, in terza persona"),
    replaces: z.array(z.string()).describe("id dei fatti noti che questo rende non più veri"),
    validFrom: z.string().nullable().describe("Da quando vale, YYYY-MM-DD, se detto; null altrimenti"),
  })).describe("Solo fatti stabili e nuovi (lavoro, ruolo, abitudini, preferenze), mai quelli già noti. Vuoto se non ce ne sono."),
  tasks: z.array(z.object({ title: z.string(), due: z.string().nullable().describe("YYYY-MM-DD se detto") })).describe("Cose da fare emerse (es. «devo mandare i documenti all'HR entro venerdì»). Vuoto se nessuna."),
  projectId: z.string().nullable().describe("id di un progetto a cui la giornata si riferisce, se chiaro"),
  aimId: z.string().nullable().describe("id di un obiettivo personale a cui la giornata si riferisce, se chiaro"),
  aimReached: z.boolean().describe("true se dalla conversazione l'obiettivo aimId risulta raggiunto"),
});

/**
 * Alla chiusura: dalla conversazione ricava la nota di diario, le persone, i fatti, le attività e i collegamenti.
 * Restituisce azioni e fatti da mostrare in un'unica scheda di conferma (nulla viene scritto qui).
 */
export async function extractDiary(checkinId: string, conversation: { role: "user" | "assistant"; text: string }[]): Promise<{ actions: CommandAction[]; facts: ProposedFact[]; names: Record<string, string> }> {
  const c = await getCheckin(checkinId);
  const [pp, fs, ps, as] = await Promise.all([
    db.select({ id: people.id, name: people.name, role: people.role, org: people.org }).from(people),
    db.select({ id: facts.id, text: facts.text }).from(facts).where(eq(facts.status, "confirmed")),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.status, ["Attivo", "In pausa"])),
    db.select({ id: aims.id, title: aims.title }).from(aims).where(inArray(aims.status, ["active", "paused"])),
  ]);
  const out = await callJSON<z.infer<typeof ExtractSchema>>({
    tier: "smart", task: "com_e_andata", name: "diario_estrazione", maxTokens: 2500, temperature: 0, persona: false,
    messages: [
      { role: "system", content: "Dalla conversazione serale tra l'utente e il suo Second Brain ricava cosa conviene ricordare. Solo ciò che l'utente ha detto davvero, niente supposizioni. Usa gli id noti quando una persona, un progetto o un obiettivo è già in memoria." },
      { role: "user", content: `<oggi>${isoDay()}</oggi>\n<motivo_del_check_in>\n${(c?.events ?? []).map((e) => e.text).join("\n") || "check-in generico"}\n</motivo_del_check_in>\n<persone_note>${JSON.stringify(pp)}</persone_note>\n<fatti_noti>${JSON.stringify(fs)}</fatti_noti>\n<progetti>${JSON.stringify(ps)}</progetti>\n<obiettivi_personali>${JSON.stringify(as)}</obiettivi_personali>\n<conversazione>\n${conversation.map((t) => `${t.role === "user" ? "Utente" : "Second Brain"}: ${t.text}`).join("\n")}\n</conversazione>` },
    ],
    jsonSchema: z.toJSONSchema(ExtractSchema),
    parse: (v) => ExtractSchema.safeParse(v) as { success: true; data: z.infer<typeof ExtractSchema> } | { success: false },
  });

  const personIds = new Set(pp.map((p) => p.id));
  const byName = new Map(pp.map((p) => [p.name.toLowerCase().trim(), p.id]));
  const factText = new Map(fs.map((f) => [f.id, f.text]));
  const projectId = out.projectId && ps.some((p) => p.id === out.projectId) ? out.projectId : null;
  const aimId = out.aimId && as.some((a) => a.id === out.aimId) ? out.aimId : null;
  const nul = { text: null, title: null, goalId: null, taskId: null, due: null, time: null, remind: null, prio: null, projectId: null, itemId: null, targetId: null, summary: null, tags: null, removeTags: null, addPeople: null, reason: null, conflict: null, status: null, pct: null, next: null, description: null, personId: null, name: null, role: null, org: null, email: null, note: null };
  const day = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

  const actions: CommandAction[] = [];
  const mentioned: string[] = [];
  for (const p of out.people.slice(0, 8)) {
    const name = p.name.trim();
    if (!name) continue;
    const pid = (p.personId && personIds.has(p.personId) ? p.personId : null) ?? byName.get(name.toLowerCase()) ?? null;
    mentioned.push(name);
    const known = pid ? pp.find((x) => x.id === pid) : null;
    // Una persona già nota senza niente di nuovo non serve riproporla.
    if (known && !p.note && (!p.role || p.role === known.role) && (!p.org || p.org === known.org)) continue;
    actions.push({ ...nul, kind: "upsert_person", label: pid ? `Aggiorna ${name}` : `Nuova persona: ${name}`, personId: pid, name: pid ? null : name, role: p.role, org: p.org, note: p.note } as CommandAction);
  }
  for (const t of out.tasks.slice(0, 5)) if (t.title.trim()) actions.push({ ...nul, kind: "add_task", label: t.title.trim(), title: t.title.trim(), due: day(t.due), projectId, goalId: aimId } as CommandAction);
  if (aimId && out.aimReached) actions.push({ ...nul, kind: "complete_goal", label: `Obiettivo raggiunto: ${as.find((a) => a.id === aimId)!.title}`, goalId: aimId } as CommandAction);
  // La nota di diario per ultima: così collega anche le persone appena create.
  actions.push({
    ...nul, kind: "diary_note", label: `Nel diario: «${out.diary.title.trim()}»`, title: out.diary.title.trim().slice(0, 140), text: out.diary.text.trim(), summary: out.diary.summary.trim(),
    tags: [...new Set(["diario", ...out.diary.tags.map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean)])].slice(0, 5),
    projectId, goalId: aimId, peopleNames: [...new Set(mentioned)],
  } as CommandAction);

  const factsOut: ProposedFact[] = out.facts.filter((f) => f.text.trim() && !fs.some((k) => k.text.toLowerCase() === f.text.trim().toLowerCase())).slice(0, 4)
    .map((f) => ({ text: f.text.trim(), validFrom: day(f.validFrom), replaces: f.replaces.filter((id) => factText.has(id)).map((id) => ({ id, text: factText.get(id)! })) }));

  const names: Record<string, string> = Object.fromEntries([...pp.map((p) => [p.id, p.name]), ...ps.map((p) => [p.id, p.name]), ...as.map((a) => [a.id, a.title])]);
  await db.update(checkins).set({ status: "closed", closedAt: new Date(), proposals: { actions, facts: factsOut } }).where(eq(checkins.id, checkinId));
  await log("Com'è andata oggi?: proposte", null, `${actions.length} azioni e ${factsOut.length} fatti da confermare`);
  return { actions, facts: factsOut, names };
}

/** Il diario di ieri sera, per il riepilogo del mattino («ieri sera mi hai detto che…»). */
export async function lastNightDiary(): Promise<string | null> {
  const since = new Date(Date.now() - 30 * 3600000);
  const rows = await db.select({ title: items.title, summary: items.summary, tags: items.tags, createdAt: items.createdAt }).from(items).where(and(eq(items.status, "memory"), gte(items.createdAt, since))).orderBy(desc(items.createdAt));
  const d = rows.find((r) => r.tags.includes("diario") && isoDay(r.createdAt) !== isoDay());
  return d ? `${d.title}${d.summary ? ": " + d.summary : ""}` : null;
}

export async function saveCheckinPrefsRaw(p: CheckinPrefs) {
  await setSetting("checkin_prefs", JSON.stringify(p));
}
