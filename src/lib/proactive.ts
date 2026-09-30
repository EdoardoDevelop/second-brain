import "server-only";
import { z } from "zod";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, newId } from "./db";
import { aimItems, aims, facts, goals, insights, itemPeople, items, links, people, projects, tasks, type Why } from "./db/schema";
import { cleanActions, CommandActionSchema, type CommandAction } from "./ai";
import { TOOL_BY_NAME } from "./api-core";
import { dueInfo, isoDay } from "./format";
import { budgetState, callJSON } from "./llm";
import { log } from "./pipeline";
import { commandContext } from "./queries";
import { detectHabits, sameSeries, upcomingDeadlines } from "./habits";
import { lastNightDiary } from "./checkin";
import { getSetting, setSetting } from "./settings";
import { upcomingBirthdays, whenLabel, type Birthday } from "./birthdays";

/**
 * L'IA che prende l'iniziativa: riepilogo del mattino e suggerimenti.
 * I segnali (note senza progetto con tag in comune, persone non sentite da tempo, progetti fermi,
 * attività scadute, conflitti, bilancio della settimana) li calcola il codice; l'IA sceglie i più utili,
 * li spiega e propone azioni, che l'utente conferma dalla Home. Nulla viene eseguito da solo.
 */

const DAY = 86400000;

export type DailyBrief = {
  day: string; title: string; body: string; highlights: string[]; at: number;
  /** «Cosa è cambiato» dall'ultimo riepilogo: righe scritte dall'IA, etichetta del periodo («Da ieri», «Da venerdì») e conteggi con i link. */
  changes?: string[]; sinceLabel?: string; delta?: { label: string; href: string }[];
};

export async function getDailyBrief(): Promise<DailyBrief | null> {
  try {
    const b = JSON.parse((await getSetting("daily_brief")) ?? "null") as DailyBrief | null;
    return b && b.day === isoDay() ? b : null;
  } catch { return null; }
}

const BriefSchema = z.object({
  title: z.string().describe("Saluto e sintesi della giornata in una riga, massimo 60 caratteri (es. «Buongiorno! Due scadenze e una riunione»)"),
  body: z.string().describe("Una o due frasi per la notifica: le cose più importanti di oggi"),
  highlights: z.array(z.string()).describe("0-5 punti brevi e concreti su oggi: cosa scade o è scaduto, cosa aspetta in Inbox, abitudini in arrivo, eventuali attenzioni. Gli obiettivi aperti senza data non sono cose da fare oggi. Mai cose che l'utente fa in un altro giorno della settimana"),
  changes: z.array(z.string()).describe("Cosa è cambiato dall'ultimo riepilogo, in 1-4 righe brevi, usando SOLO <cambiato>: raggruppa (es. «3 note nuove su Progetto Alpha, 2 senza progetto»), cita nomi e titoli solo se pochi. Non ripetere i punti di highlights. Vuoto se non è cambiato nulla."),
});

// ——— Cosa è cambiato dall'ultimo riepilogo ———

/**
 * Istantanea di ciò che non ha una data propria (attività completate, scadute, persone da risentire, conflitti,
 * fatti non più veri): il confronto con quella del giorno prima dice cosa è cambiato.
 */
type Snapshot = { done: string[]; overdue: string[]; quiet: string[]; conflicts: string[]; obsolete: string[] };
type SnapState = { day: string; at: number; data: Snapshot };

export type Changes = {
  since: number;
  newItems: { project: string | null; projectId: string | null; items: { id: string; title: string; type: string | null }[] }[];
  completed: { id: string; title: string }[];
  newTasks: { id: string; title: string; due: string | null }[];
  newlyOverdue: { id: string; title: string; due: string | null }[];
  heard: { id: string; name: string; items: number }[];
  toReach: { id: string; name: string; days: number }[];
  newConflicts: { a: string; b: string; reason: string }[];
  newFacts: string[];
  endedFacts: string[];
};

/** Persone non sentite da oltre 30 giorni che hanno attività aperte legate a loro. */
function quietPeople(
  mem: { id: string; createdAt: Date }[], pp: { id: string; name: string; role: string | null }[],
  ip: { itemId: string; personId: string }[], openTasks: { id: string; title: string; sourceItemId: string | null }[], now: number,
) {
  const lastSeen = new Map<string, number>();
  const memAt = new Map(mem.map((i) => [i.id, i.createdAt.getTime()]));
  for (const x of ip) { const at = memAt.get(x.itemId); if (at) lastSeen.set(x.personId, Math.max(lastSeen.get(x.personId) ?? 0, at)); }
  return pp.map((p) => {
    const at = lastSeen.get(p.id);
    const theirItems = new Set(ip.filter((x) => x.personId === p.id).map((x) => x.itemId));
    const pending = openTasks.filter((t) => t.sourceItemId && theirItems.has(t.sourceItemId));
    return { id: p.id, name: p.name, role: p.role, days: at ? Math.round((now - at) / DAY) : null, pendingTasks: pending.map((t) => ({ id: t.id, title: t.title })) };
  }).filter((p): p is typeof p & { days: number } => p.days != null && p.days > 30 && p.pendingTasks.length > 0);
}

/**
 * Differenze dall'ultimo riepilogo, calcolate dal codice. La base è l'istantanea del primo riepilogo di un giorno
 * precedente (al massimo 7 giorni fa), quindi rifare il riepilogo durante la giornata non azzera le novità.
 * Senza istantanea (prima volta) valgono le ultime 24 ore e i confronti tra istantanee restano vuoti.
 */
export async function computeChanges(): Promise<Changes> {
  const now = Date.now();
  const today = isoDay();
  const [mem, ps, pp, ip, ts, ls, fs] = await Promise.all([
    db.select({ id: items.id, title: items.title, type: items.type, projectId: items.projectId, createdAt: items.createdAt, confirmedAt: items.confirmedAt }).from(items).where(eq(items.status, "memory")),
    db.select({ id: projects.id, name: projects.name }).from(projects),
    db.select({ id: people.id, name: people.name, role: people.role }).from(people),
    db.select().from(itemPeople),
    db.select({ id: tasks.id, title: tasks.title, done: tasks.done, due: tasks.due, sourceItemId: tasks.sourceItemId, createdAt: tasks.createdAt }).from(tasks),
    db.select().from(links).where(eq(links.kind, "conflict")),
    db.select({ id: facts.id, text: facts.text, status: facts.status, createdAt: facts.createdAt }).from(facts),
  ]);
  const openTasks = ts.filter((t) => !t.done);
  const snap: Snapshot = {
    done: ts.filter((t) => t.done).map((t) => t.id),
    overdue: openTasks.filter((t) => t.due && t.due < today).map((t) => t.id),
    quiet: quietPeople(mem, pp, ip, openTasks, now).map((p) => p.id),
    conflicts: ls.map((l) => `${l.fromId}|${l.toId}`),
    obsolete: fs.filter((f) => f.status === "obsolete").map((f) => f.id),
  };

  // Rotazione: la prima volta di ogni giorno l'istantanea precedente diventa la base di oggi.
  const parse = (k: string) => { try { return JSON.parse(k) as SnapState | null; } catch { return null; } };
  const cur = parse((await getSetting("brief_snap")) ?? "null");
  let base = parse((await getSetting("brief_base")) ?? "null");
  if (cur?.day !== today) {
    base = cur;
    await setSetting("brief_base", JSON.stringify(base));
    await setSetting("brief_snap", JSON.stringify({ day: today, at: now, data: snap } satisfies SnapState));
  }
  if (base && now - base.at > 7 * DAY) base = null;
  const since = base?.at ?? now - DAY;
  const prev = base?.data;
  const fresh = (ids: string[], old: string[] | undefined) => { const o = new Set(old ?? ids); return ids.filter((id) => !o.has(id)); };

  const projectName = new Map(ps.map((p) => [p.id, p.name]));
  const added = mem.filter((i) => (i.confirmedAt ?? i.createdAt).getTime() >= since);
  const groups = new Map<string | null, typeof added>();
  for (const i of added) { const k = i.projectId && projectName.has(i.projectId) ? i.projectId : null; groups.set(k, [...(groups.get(k) ?? []), i]); }
  const newItems = [...groups].sort((a, b) => b[1].length - a[1].length).map(([pid, l]) => ({
    project: pid ? projectName.get(pid)! : null, projectId: pid, items: l.slice(0, 5).map((i) => ({ id: i.id, title: i.title, type: i.type })),
  }));

  const addedIds = new Set(added.map((i) => i.id));
  const heardCount = new Map<string, number>();
  for (const x of ip) if (addedIds.has(x.itemId)) heardCount.set(x.personId, (heardCount.get(x.personId) ?? 0) + 1);
  const quiet = quietPeople(mem, pp, ip, openTasks, now);
  const newQuiet = new Set(fresh(snap.quiet, prev?.quiet));
  const task = new Map(ts.map((t) => [t.id, t]));
  const memTitle = new Map(mem.map((i) => [i.id, i.title]));
  const yesterday = isoDay(new Date(now - DAY));

  return {
    since,
    newItems,
    completed: fresh(snap.done, prev?.done).map((id) => ({ id, title: task.get(id)!.title })).slice(0, 10),
    newTasks: openTasks.filter((t) => t.createdAt.getTime() >= since).map((t) => ({ id: t.id, title: t.title, due: t.due })).slice(0, 10),
    // Senza base: quelle scadute ieri (sono diventate scadute oggi).
    newlyOverdue: (prev ? fresh(snap.overdue, prev.overdue) : openTasks.filter((t) => t.due === yesterday).map((t) => t.id))
      .map((id) => ({ id, title: task.get(id)!.title, due: task.get(id)!.due })).slice(0, 10),
    heard: [...heardCount].map(([id, n]) => ({ id, name: pp.find((p) => p.id === id)?.name ?? "", items: n })).filter((p) => p.name).slice(0, 8),
    toReach: quiet.filter((p) => newQuiet.has(p.id)).map((p) => ({ id: p.id, name: p.name, days: p.days })),
    newConflicts: fresh(snap.conflicts, prev?.conflicts).map((k) => ls.find((l) => `${l.fromId}|${l.toId}` === k)!)
      .filter((l) => memTitle.has(l.fromId) && memTitle.has(l.toId))
      .map((l) => ({ a: memTitle.get(l.fromId)!, b: memTitle.get(l.toId)!, reason: l.reason })).slice(0, 5),
    newFacts: fs.filter((f) => f.status === "confirmed" && f.createdAt.getTime() >= since).map((f) => f.text).slice(0, 5),
    endedFacts: fresh(snap.obsolete, prev?.obsolete).map((id) => fs.find((f) => f.id === id)!.text).slice(0, 5),
  };
}

const isEmpty = (c: Changes) => !c.newItems.length && !c.completed.length && !c.newTasks.length && !c.newlyOverdue.length
  && !c.heard.length && !c.toReach.length && !c.newConflicts.length && !c.newFacts.length && !c.endedFacts.length;

/** «Da ieri», «Da venerdì» o «Dal 21 settembre»: il periodo coperto dalle novità. */
function sinceLabel(since: number) {
  const days = Math.round((Date.parse(isoDay()) - Date.parse(isoDay(new Date(since)))) / DAY);
  if (days <= 1) return "Da ieri";
  if (days < 7) {
    const wd = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long" }).format(new Date(since));
    return "Da " + wd;
  }
  return "Dal " + new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long" }).format(new Date(since));
}

/** Conteggi con il link alla pagina dove vederli (sotto le righe dell'IA). */
function deltaChips(c: Changes): { label: string; href: string }[] {
  const n = c.newItems.reduce((s, g) => s + g.items.length, 0);
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return [
    n && { label: plural(n, "elemento nuovo", "elementi nuovi"), href: "/timeline" },
    c.completed.length && { label: plural(c.completed.length, "attività completata", "attività completate"), href: "/attivita" },
    c.newTasks.length && { label: plural(c.newTasks.length, "attività nuova", "attività nuove"), href: "/attivita" },
    c.newlyOverdue.length && { label: plural(c.newlyOverdue.length, "scaduta", "scadute"), href: "/attivita" },
    c.heard.length && { label: plural(c.heard.length, "persona sentita", "persone sentite"), href: "/persone" },
    c.toReach.length && { label: plural(c.toReach.length, "da risentire", "da risentire"), href: "/persone" },
    c.newConflicts.length && { label: plural(c.newConflicts.length, "conflitto nuovo", "conflitti nuovi"), href: "/conoscenza" },
    (c.newFacts.length || c.endedFacts.length) && { label: plural(c.newFacts.length + c.endedFacts.length, "fatto su di te", "fatti su di te"), href: "/memoria" },
  ].filter((x): x is { label: string; href: string } => !!x);
}

/** Per la notifica senza IA: le novità in una riga. */
export function changesLine(c: Changes) {
  const chips = deltaChips(c);
  return chips.length ? `${sinceLabel(c.since)}: ${chips.map((x) => x.label).join(", ")}` : "";
}

/**
 * Fatti confermati e validi oggi, da mettere accanto ai dati del giorno: in fondo al prompt di sistema
 * il modello tendeva a ignorarli (es. «fa i lavori di casa il sabato»).
 */
async function currentFacts(): Promise<string[]> {
  const day = isoDay();
  return (await db.select({ text: facts.text, validFrom: facts.validFrom, validUntil: facts.validUntil }).from(facts).where(eq(facts.status, "confirmed")))
    .filter((f) => (!f.validFrom || f.validFrom <= day) && (!f.validUntil || f.validUntil >= day)).map((f) => f.text).slice(0, 60);
}
/** Compleanni per i prompt: quello dell'utente solo oggi, gli altri anche nei prossimi giorni (per un regalo o un messaggio). */
const birthdayRows = (bs: Birthday[]) => bs.map((b) => ({ chi: b.user ? "l'utente" : b.who, quando: whenLabel(b.daysTo), ...(b.age ? { compie: b.age } : {}) }));
const birthdaysBlock = (bs: Birthday[]) => bs.length ? `\n<compleanni>\n${JSON.stringify(birthdayRows(bs))}\n</compleanni>` : "";
const factsBlock = (fs: string[]) => fs.length ? `\n<cosa_so_dell_utente>\n${fs.map((t) => "- " + t).join("\n")}\n</cosa_so_dell_utente>` : "";

/** Riepilogo del mattino scritto dall'IA (salvato in settings.daily_brief e mostrato nella Home). */
export async function morningBrief(): Promise<DailyBrief> {
  const today = await TOOL_BY_NAME.get("today")!.run({});
  const changes = await computeChanges();
  const diary = await lastNightDiary().catch(() => null);
  const habitsSoon = (await detectHabits().catch(() => [])).filter((h) => h.daysToNext <= 1)
    .map((h) => ({ cosa: h.label, quando: h.daysToNext === 0 ? "oggi" : "domani", ritmo: h.cadenceLabel }));
  const empty = isEmpty(changes);
  const current = await currentFacts();
  const bdays = (await upcomingBirthdays(7).catch(() => [])).filter((b) => !b.user || b.daysTo === 0);
  // Solo i campi con qualcosa, per non far inventare novità all'IA.
  const delta = Object.fromEntries(Object.entries(changes).filter(([k, v]) => k !== "since" && Array.isArray(v) && v.length));
  const out = await callJSON<z.infer<typeof BriefSchema>>({
    tier: "smart", task: "riepilogo_mattino", name: "riepilogo_mattino", maxTokens: 1200,
    messages: [
      { role: "system", content: "Scrivi il riepilogo del mattino del Second Brain personale dell'utente, in italiano. Breve, concreto e incoraggiante; niente elenchi infiniti. Usa solo i dati forniti. Se la giornata è libera, dillo in modo positivo. In <cambiato> ci sono le novità dall'ultimo riepilogo (" + sinceLabel(changes.since).toLowerCase() + "): mettile in changes, non in highlights. Le abitudini in arrivo (cose che l'utente fa di solito oggi o domani) vanno ricordate in highlights. Gli obiettivi aperti senza data (openGoals) non sono cose da fare oggi: citali solo se oggi è il giorno giusto per quel lavoro. Prima di scrivere, leggi <cosa_so_dell_utente> e il giorno della settimana: se l'utente fa certe cose in un altro giorno (es. i lavori di casa il sabato), non metterle né nel titolo né in highlights né nel body; al più un accenno («sabato: casa») se il giorno è vicino. Se c'è il racconto di ieri sera, puoi riprenderlo con naturalezza (es. «ieri mi hai detto che…») quando è utile per oggi. Se in <compleanni> oggi è il compleanno dell'utente, il titolo sono gli auguri (con gli anni che compie, se noti) e il body resta caloroso e leggero. I compleanni di altre persone di oggi o dei prossimi giorni vanno in highlights (es. «Sabato compie gli anni Clelia: un pensiero?»)." },
      { role: "user", content: `<oggi>\n${JSON.stringify(today)}\n</oggi>${factsBlock(current)}${birthdaysBlock(bdays)}${habitsSoon.length ? `\n<abitudini_in_arrivo>\n${JSON.stringify(habitsSoon)}\n</abitudini_in_arrivo>` : ""}${diary ? `\n<ieri_sera_mi_ha_raccontato>\n${diary}\n</ieri_sera_mi_ha_raccontato>` : ""}\n<cambiato>\n${empty ? "Nulla di nuovo." : JSON.stringify(delta)}\n</cambiato>` },
    ],
    jsonSchema: z.toJSONSchema(BriefSchema),
    parse: (v) => BriefSchema.safeParse(v) as { success: true; data: z.infer<typeof BriefSchema> } | { success: false },
  });
  const brief: DailyBrief = {
    day: isoDay(), title: out.title.slice(0, 80), body: out.body.slice(0, 300), highlights: out.highlights.slice(0, 5), at: Date.now(),
    changes: empty ? [] : out.changes.map((c) => c.trim()).filter(Boolean).slice(0, 4), sinceLabel: sinceLabel(changes.since), delta: deltaChips(changes),
  };
  await setSetting("daily_brief", JSON.stringify(brief));
  await log("Riepilogo del mattino", null, brief.title);
  return brief;
}

/** Segnali calcolati dai dati: il materiale su cui l'IA sceglie i suggerimenti. */
async function signals() {
  const now = Date.now();
  const today = isoDay();
  const [mem, ps, pp, ip, ts, gs, ls, as, ai] = await Promise.all([
    db.select({ id: items.id, title: items.title, type: items.type, tags: items.tags, projectId: items.projectId, createdAt: items.createdAt }).from(items).where(eq(items.status, "memory")).orderBy(desc(items.createdAt)),
    db.select().from(projects),
    db.select().from(people),
    db.select().from(itemPeople),
    db.select().from(tasks),
    db.select().from(goals),
    db.select().from(links).where(eq(links.kind, "conflict")),
    db.select().from(aims).where(eq(aims.status, "active")),
    db.select().from(aimItems),
  ]);

  // Note recenti senza progetto che condividono un tag: forse un progetto nuovo o da assegnare.
  const loose = mem.filter((i) => !i.projectId && now - i.createdAt.getTime() < 60 * DAY);
  const byTag = new Map<string, typeof loose>();
  for (const i of loose) for (const t of i.tags) byTag.set(t, [...(byTag.get(t) ?? []), i]);
  const clusters = [...byTag].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 4)
    .map(([tag, l]) => ({ tag, items: l.slice(0, 6).map((i) => ({ id: i.id, title: i.title })) }));

  // Persone non sentite da oltre 30 giorni con attività aperte o in progetti attivi.
  const openTasks = ts.filter((t) => !t.done);
  const quiet = quietPeople(mem, pp, ip, openTasks, now).slice(0, 4);

  // Progetti attivi fermi: niente di nuovo da 14 giorni.
  const stale = ps.filter((p) => p.status === "Attivo").map((p) => {
    const lastItem = Math.max(0, ...mem.filter((i) => i.projectId === p.id).map((i) => i.createdAt.getTime()));
    const lastTask = Math.max(0, ...ts.filter((t) => t.projectId === p.id).map((t) => t.createdAt.getTime()));
    const last = Math.max(lastItem, lastTask);
    return { id: p.id, name: p.name, pct: p.pct, next: p.next, days: last ? Math.round((now - last) / DAY) : null, openTasks: openTasks.filter((t) => t.projectId === p.id).length, openGoals: gs.filter((g) => g.projectId === p.id && !g.done).length };
  }).filter((p) => p.days != null && p.days >= 14).slice(0, 4);

  const overdue = openTasks.filter((t) => t.due && t.due < today && dueInfo(t.due).group === "overdue")
    .map((t) => ({ id: t.id, title: t.title, due: t.due, days: Math.round((Date.parse(today) - Date.parse(t.due!)) / DAY) }))
    .filter((t) => t.days >= 3).slice(0, 6);

  const title = new Map(mem.map((i) => [i.id, i.title]));
  const conflicts = ls.filter((l) => title.has(l.fromId) && title.has(l.toId)).slice(0, 4)
    .map((l) => ({ a: { id: l.fromId, title: title.get(l.fromId) }, b: { id: l.toId, title: title.get(l.toId) }, reason: l.reason }));

  // Il lunedì: bilancio della settimana passata.
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", weekday: "short" }).format(new Date());
  const week = weekday === "Mon" ? {
    captured: mem.filter((i) => now - i.createdAt.getTime() < 7 * DAY).map((i) => ({ title: i.title, type: i.type })).slice(0, 20),
    decisions: mem.filter((i) => i.type === "Decisione" && now - i.createdAt.getTime() < 7 * DAY).map((i) => i.title),
    openTasks: openTasks.length,
  } : null;

  // Obiettivi personali attivi: tutti (sono pochi), con i segnali che meritano attenzione.
  const memAt = new Map(mem.map((i) => [i.id, i.createdAt.getTime()]));
  const aimed = new Set(ai.map((x) => x.itemId));
  const personalGoals = as.map((a) => {
    const t = ts.filter((x) => x.aimId === a.id);
    const linked = ai.filter((x) => x.aimId === a.id && memAt.has(x.itemId));
    const last = Math.max(a.createdAt.getTime(), ...t.map((x) => x.createdAt.getTime()), ...linked.map((x) => memAt.get(x.itemId)!));
    const daysLeft = a.due ? Math.round((Date.parse(a.due) - Date.parse(today)) / DAY) : null;
    const open = t.filter((x) => !x.done);
    return {
      id: a.id, title: a.title, description: a.description.slice(0, 200), due: a.due, daysLeft,
      openTasks: open.slice(0, 5).map((x) => ({ id: x.id, title: x.title, due: x.due })), doneTasks: t.length - open.length,
      linkedItems: linked.length, idleDays: Math.round((now - last) / DAY),
      dueSoon: daysLeft != null && daysLeft <= 14, idle: Math.round((now - last) / DAY) >= 21, noNextStep: !open.length,
    };
  });
  // Elementi recenti non ancora collegati a un obiettivo: l'IA può proporre di collegarli (update_item con goalId).
  const unlinked = personalGoals.length ? mem.filter((i) => !aimed.has(i.id) && now - i.createdAt.getTime() < 14 * DAY).slice(0, 15).map((i) => ({ id: i.id, title: i.title, type: i.type, tags: i.tags })) : [];

  // Anticipazione: abitudini attese nei prossimi 2 giorni e non ancora in programma, gruppi di scadenze vicine.
  const seen = new Set<string>(JSON.parse((await getSetting("anticipation_seen")) ?? "[]"));
  const habits = (await detectHabits().catch(() => []))
    .filter((h) => h.daysToNext <= 2 && !seen.has(`h:${h.key}:${h.next}`))
    .filter((h) => !openTasks.some((t) => sameSeries(t.title, h.label) && (!t.due || t.due >= today)))
    .slice(0, 3)
    .map((h) => ({ key: `h:${h.key}:${h.next}`, label: h.label, rhythm: h.cadenceLabel, next: h.next, daysToNext: h.daysToNext, dates: h.dates.slice(-6), lastTimes: h.recent }));
  const deadlines = (await upcomingDeadlines().catch(() => []))
    .filter((d) => !seen.has(`d:${d.key}:${d.until}`))
    .map((d) => ({ ...d, seenKey: `d:${d.key}:${d.until}` }));

  const weekdayName = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long" }).format(new Date());
  // Compleanni di altre persone nei prossimi giorni: occasione per un messaggio o un regalo.
  const birthdays = birthdayRows((await upcomingBirthdays(7).catch(() => [])).filter((b) => !b.user));
  return { today, weekday: weekdayName, birthdays, clusters, quiet, stale, overdue, conflicts, week, personalGoals, unlinked, habits, deadlines, projects: ps.filter((p) => p.status !== "Chiuso").map((p) => ({ id: p.id, name: p.name })) };
}

const InsightSchema = z.object({
  insights: z.array(z.object({
    kind: z.enum(["project", "follow_up", "stale", "overdue", "conflict", "weekly", "goal", "habit", "plan", "other"]),
    title: z.string().describe("Il suggerimento in una riga, concreto (es. «Tre note sul cantiere non hanno un progetto»)"),
    body: z.string().describe("Una o due frasi: perché conta e cosa proponi"),
    refs: z.array(z.string()).describe("id di elementi, progetti, persone o obiettivi personali citati"),
    actions: z.array(CommandActionSchema).describe("Azioni da proporre; vuoto se è solo un'osservazione"),
  })),
});

/** Validazione tollerante: le azioni si normalizzano poi con cleanActions (campi mancanti = null). */
const InsightLoose = z.object({
  insights: z.array(z.object({
    kind: z.string(),
    title: z.string(),
    body: z.string().default(""),
    refs: z.array(z.string()).default([]),
    actions: z.array(z.record(z.string(), z.unknown())).default([]),
  })),
});

export type InsightRow = { id: string; kind: string; title: string; body: string; actions: CommandAction[]; names: Record<string, string>; refs: { id: string; title: string; href: string }[]; why: Why[] };

const ddmm = (day: string) => day.slice(8, 10) + "/" + day.slice(5, 7);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * «Perché me lo suggerisci?»: i segnali calcolati dal codice che riguardano gli elementi del suggerimento
 * (quelli citati e quelli toccati dalle azioni). Sono dati, non parole dell'IA.
 */
function evidence(s: Awaited<ReturnType<typeof signals>>, kind: string, ids: Set<string>): Why[] {
  // Un gruppo di motivi per segnale: quello del tipo di suggerimento va per primo.
  const by: Record<string, Why[]> = { project: [], follow_up: [], stale: [], overdue: [], conflict: [], weekly: [], goal: [], habit: [], plan: [] };
  let out = by.project;
  for (const c of s.clusters) {
    if (!c.items.some((i) => ids.has(i.id))) continue;
    out.push({ text: `${plural(c.items.length, "nota recente senza progetto ha", "note recenti senza progetto hanno")} il tag #${c.tag}: ${c.items.slice(0, 3).map((i) => `«${i.title}»`).join(", ")}${c.items.length > 3 ? "…" : ""}`, href: `/conoscenza/${c.items[0].id}` });
  }
  out = by.follow_up;
  for (const p of s.quiet) {
    if (!ids.has(p.id) && !p.pendingTasks.some((t) => ids.has(t.id))) continue;
    out.push({ text: `Non ci sono novità su ${p.name}${p.role ? ` (${p.role})` : ""} da ${p.days} giorni`, href: `/persone/${p.id}` });
    if (p.pendingTasks.length) out.push({ text: `${plural(p.pendingTasks.length, "attività in sospeso collegata", "attività in sospeso collegate")}: ${p.pendingTasks.slice(0, 3).map((t) => `«${t.title}»`).join(", ")}`, href: "/attivita" });
  }
  out = by.stale;
  for (const p of s.stale) {
    if (!ids.has(p.id)) continue;
    out.push({ text: `Nessuna novità sul progetto «${p.name}» da ${p.days} giorni`, href: `/progetti/${p.id}` });
    out.push({ text: `Avanzamento ${p.pct}% · ${plural(p.openTasks, "attività aperta", "attività aperte")} · ${plural(p.openGoals, "obiettivo aperto", "obiettivi aperti")}${p.next ? ` · prossima milestone: ${p.next}` : ""}` });
  }
  out = by.overdue;
  for (const t of s.overdue) {
    if (!ids.has(t.id)) continue;
    out.push({ text: `«${t.title}» è scaduta da ${t.days} giorni (il ${ddmm(t.due!)})`, href: "/attivita" });
  }
  out = by.conflict;
  for (const c of s.conflicts) {
    if (!ids.has(c.a.id) && !ids.has(c.b.id)) continue;
    out.push({ text: `«${c.a.title}» e «${c.b.title}» si contraddicono${c.reason ? `: ${c.reason}` : ""}`, href: `/conoscenza/${c.a.id}` });
  }
  out = by.goal;
  for (const g of s.personalGoals) {
    if (!ids.has(g.id) && !g.openTasks.some((t) => ids.has(t.id))) continue;
    const when = g.daysLeft == null ? "" : g.daysLeft < 0 ? ` · scaduto da ${-g.daysLeft} giorni` : g.daysLeft === 0 ? " · scade oggi" : ` · mancano ${g.daysLeft} giorni (entro il ${ddmm(g.due!)})`;
    out.push({ text: `Obiettivo «${g.title}»${when}`, href: `/obiettivi/${g.id}` });
    out.push({ text: `${plural(g.openTasks.length, "attività aperta", "attività aperte")}, ${plural(g.doneTasks, "fatta", "fatte")} · ${plural(g.linkedItems, "elemento collegato", "elementi collegati")}${g.idle ? ` · nessuna novità da ${g.idleDays} giorni` : ""}` });
  }
  out = by.habit;
  if (kind === "habit") {
    // Solo l'abitudine di cui parla il suggerimento (dalle ultime volte citate); se non si capisce, la più vicina.
    const hs = s.habits.filter((h) => h.lastTimes.some((x) => ids.has(x.id)));
    for (const h of hs.length ? hs : s.habits.slice(0, 1)) {
      out.push({ text: `Lo fai ${h.rhythm}: ${h.dates.map(ddmm).join(", ")}` });
      out.push({ text: `Prossima volta attesa: ${h.daysToNext === 0 ? "oggi" : h.daysToNext === 1 ? "domani" : "dopodomani"} (${ddmm(h.next)})` });
      const lastItem = h.lastTimes.find((x) => x.source === "item");
      if (lastItem) out.push({ text: `L'ultima volta: «${lastItem.title}» del ${ddmm(lastItem.date)}`, href: `/conoscenza/${lastItem.id}` });
    }
  }
  out = by.plan;
  for (const d of s.deadlines) {
    if (!d.dueSoon.some((t) => ids.has(t.id)) && !d.undated.some((t) => ids.has(t.id)) && !(d.id && ids.has(d.id))) continue;
    const href = d.kind === "project" ? `/progetti/${d.id}` : d.kind === "aim" ? `/obiettivi/${d.id}` : "/attivita";
    out.push({ text: `${d.name}: ${plural(d.dueSoon.length, "attività in scadenza", "attività in scadenza")} entro il ${ddmm(d.until)}${d.aimDue ? " (scadenza dell'obiettivo)" : ""}`, href });
    if (d.undated.length) out.push({ text: `${plural(d.undated.length, "attività senza data", "attività senza data")} nello stesso ${d.kind === "aim" ? "obiettivo" : "progetto"}` });
    if (d.overdue.length) out.push({ text: `${plural(d.overdue.length, "già scaduta", "già scadute")}: ${d.overdue.slice(0, 2).map((t) => `«${t.title}»`).join(", ")}` });
  }
  out = by.weekly;
  if (kind === "weekly" && s.week) {
    out.push({ text: `Negli ultimi 7 giorni: ${plural(s.week.captured.length, "elemento nuovo", "elementi nuovi")}, ${plural(s.week.decisions.length, "decisione", "decisioni")}, ${plural(s.week.openTasks, "attività ancora aperta", "attività ancora aperte")}` });
  }
  return [...(by[kind] ?? []), ...Object.entries(by).filter(([k]) => k !== kind).flatMap(([, v]) => v)].slice(0, 6);
}

/** Suggerimenti del giorno (sostituiscono quelli nuovi dei giorni precedenti). */
export async function generateInsights(): Promise<number> {
  const s = await signals();
  const goalSignals = s.personalGoals.some((g) => g.dueSoon || g.idle || g.noNextStep) || s.unlinked.length > 0;
  const empty = !s.clusters.length && !s.quiet.length && !s.stale.length && !s.overdue.length && !s.conflicts.length && !s.week && !goalSignals && !s.habits.length && !s.deadlines.length && !s.birthdays.length;
  // Le proposte della cura notturna della memoria («cleanup») restano finché non si decidono.
  const dismissOld = () => db.update(insights).set({ status: "dismissed" }).where(and(eq(insights.status, "new"), ne(insights.kind, "cleanup")));
  if (empty) { await dismissOld(); await log("Suggerimenti", null, "Nessun segnale"); return 0; }

  const out = await callJSON<z.infer<typeof InsightLoose>>({
    tier: "smart", task: "suggerimenti", name: "suggerimenti", maxTokens: 3000,
    messages: [
      {
        role: "system",
        content: `Sei il Second Brain dell'utente e oggi proponi al massimo 4 suggerimenti utili, in italiano, a partire dai segnali calcolati sui suoi dati.
Tipi: project (note senza progetto con un tema comune: proponi create_project, poi update_item per assegnarle), follow_up (persona non sentita da tempo con cose in sospeso: proponi add_task "Sentire …"), stale (progetto fermo: proponi il prossimo passo come add_task), overdue (attività scadute da giorni: proponi set_task_due o complete_task), conflict (informazioni in conflitto da chiarire), weekly (il lunedì, bilancio della settimana in 2-3 frasi, senza azioni), goal (obiettivo personale in scadenza, fermo o senza un prossimo passo: proponi add_task con goalId; oppure elementi di unlinked che servono a un obiettivo: proponi update_item con goalId).
habit (una cosa che l'utente fa con regolarità e che arriva oggi, domani o dopodomani, vedi habits: proponi add_task per prepararla con due il giorno prima o il giorno stesso, e nel body di' cosa preparare o ritrovare partendo dalle ultime volte in lastTimes, citandole in refs), plan (più attività in scadenza ravvicinata nello stesso progetto o obiettivo, vedi deadlines: proponi set_task_due per dare una data alle attività senza data prima della scadenza, distribuendole nei giorni e mettendo prima le più importanti, ed eventualmente add_task per un passo che manca; nel body il piano giorno per giorno in 2-4 righe).
Oggi è ${s.weekday} ${s.today}. Rispetta ciò che i fatti in <cosa_so_dell_utente> dicono su quando l'utente fa le cose (giorni, orari, abitudini: es. «i lavori di casa li faccio il sabato»): non proporre per oggi cose che fa in un altro giorno; se serve, proponi set_task_due per il prossimo giorno giusto, altrimenti lasciale stare.
Compleanni (birthdays) di persone oggi o nei prossimi giorni: se la persona conta per l'utente, un suggerimento breve (fargli gli auguri, pensare a un regalo se mancano alcuni giorni; add_task con la data giusta solo se utile).
Gli obiettivi personali (personalGoals) sono ciò che conta di più per l'utente: se un suggerimento di qualsiasi tipo è rilevante per uno di essi, dillo nel body («Rilevante per il tuo obiettivo …») e metti il suo id in refs.
Scegli solo ciò che è davvero utile; meglio pochi suggerimenti buoni. Usa solo gli id presenti nei segnali. Le azioni verranno confermate dall'utente: compila solo i campi che servono, gli altri null.`,
      },
      { role: "user", content: `<segnali>\n${JSON.stringify(s)}\n</segnali>${factsBlock(await currentFacts())}` },
    ],
    jsonSchema: z.toJSONSchema(InsightSchema),
    parse: (v) => InsightLoose.safeParse(v) as { success: true; data: z.infer<typeof InsightLoose> } | { success: false },
  });

  const ctx = await commandContext();
  const allItems = await db.select({ id: items.id, title: items.title, type: items.type, tags: items.tags, createdAt: items.createdAt }).from(items).where(eq(items.status, "memory"));
  for (const i of allItems) if (!ctx.items.some((x) => x.id === i.id)) ctx.items.push({ id: i.id, title: i.title, type: i.type, tags: i.tags, date: isoDay(i.createdAt) });
  const titles = new Map<string, [string, string]>([
    ...allItems.map((i): [string, [string, string]] => [i.id, [i.title, `/conoscenza/${i.id}`]]),
    ...ctx.projects.map((p): [string, [string, string]] => [p.id, [p.name, `/progetti/${p.id}`]]),
    ...ctx.people.map((p): [string, [string, string]] => [p.id, [p.name, `/persone/${p.id}`]]),
    ...ctx.aims.map((a): [string, [string, string]] => [a.id, [a.title, `/obiettivi/${a.id}`]]),
  ]);
  // Solo ora che l'IA ha risposto: se fallisce, restano i suggerimenti di prima.
  await dismissOld();
  const day = isoDay();
  let n = 0;
  for (const ins of out.insights.slice(0, 4)) {
    const actions = cleanActions(ins.actions, ctx);
    const refs = [...new Set(ins.refs)].filter((id) => titles.has(id)).slice(0, 6).map((id) => ({ id, title: titles.get(id)![0], href: titles.get(id)![1] }));
    const kind = ["project", "follow_up", "stale", "overdue", "conflict", "weekly", "goal", "habit", "plan"].includes(ins.kind) ? ins.kind : "other";
    const touched = new Set([...ins.refs, ...actions.flatMap((a) => [a.itemId, a.targetId, a.taskId, a.projectId, a.personId, a.goalId]).filter((x): x is string => !!x)]);
    const why = evidence(s, kind, touched);
    await db.insert(insights).values({ id: newId("in"), day, kind, title: ins.title.slice(0, 140), body: ins.body.slice(0, 500), actions, refs, why, status: "new", createdAt: new Date() });
    n++;
  }
  const shown = [...s.habits.map((h) => h.key), ...s.deadlines.map((d) => d.seenKey)];
  if (shown.length) {
    const prev: string[] = JSON.parse((await getSetting("anticipation_seen")) ?? "[]");
    await setSetting("anticipation_seen", JSON.stringify([...new Set([...prev, ...shown])].slice(-300)));
  }
  await log("Suggerimenti", null, `${n} proposti`);
  return n;
}

/** Suggerimenti da mostrare nella Home, con i nomi leggibili degli id delle azioni. */
export async function listInsights(): Promise<InsightRow[]> {
  const rows = await db.select().from(insights).where(eq(insights.status, "new")).orderBy(desc(insights.createdAt)).limit(6);
  if (!rows.length) return [];
  const ctx = await commandContext();
  const ids = [...new Set(rows.flatMap((r) => (r.actions as CommandAction[]).flatMap((a) => [a.itemId, a.targetId]).filter((x): x is string => !!x)))];
  const extra = ids.length ? await db.select({ id: items.id, title: items.title }).from(items).where(inArray(items.id, ids)) : [];
  const factIds = [...new Set(rows.flatMap((r) => (r.actions as CommandAction[]).flatMap((a) => [a.factId, a.otherFactId]).filter((x): x is string => !!x)))];
  const factRows = factIds.length ? await db.select({ id: facts.id, title: facts.text }).from(facts).where(inArray(facts.id, factIds)) : [];
  const names = Object.fromEntries([
    ...[...ctx.projects, ...ctx.people].map((x) => [x.id, x.name]),
    ...[...ctx.tasks, ...ctx.items, ...ctx.goals, ...ctx.aims, ...extra, ...factRows].map((x) => [x.id, x.title]),
  ]);
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, actions: r.actions as CommandAction[], names, refs: r.refs, why: r.why ?? [] }));
}

/** Il giro del mattino: riepilogo e suggerimenti (se c'è budget). Restituisce il riepilogo, se scritto. */
export async function morningRound(): Promise<DailyBrief | null> {
  const b = await budgetState();
  if (b.over) return null;
  let brief: DailyBrief | null = null;
  try { brief = await morningBrief(); } catch (e) { await log("Riepilogo del mattino", null, "Errore: " + (e as Error).message); }
  // I suggerimenti sono il lusso: si saltano vicino al tetto di spesa.
  if (!b.near) {
    try { await generateInsights(); } catch (e) { await log("Suggerimenti", null, "Errore: " + (e as Error).message); }
  }
  return brief;
}
