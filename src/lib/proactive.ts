import "server-only";
import { z } from "zod";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, newId } from "./db";
import { goals, insights, itemPeople, items, links, people, projects, tasks } from "./db/schema";
import { cleanActions, CommandActionSchema, type CommandAction } from "./ai";
import { TOOL_BY_NAME } from "./api-core";
import { dueInfo, isoDay } from "./format";
import { budgetState, callJSON } from "./llm";
import { log } from "./pipeline";
import { commandContext } from "./queries";
import { getSetting, setSetting } from "./settings";

/**
 * L'IA che prende l'iniziativa: riepilogo del mattino e suggerimenti.
 * I segnali (note senza progetto con tag in comune, persone non sentite da tempo, progetti fermi,
 * attività scadute, conflitti, bilancio della settimana) li calcola il codice; l'IA sceglie i più utili,
 * li spiega e propone azioni, che l'utente conferma dalla Home. Nulla viene eseguito da solo.
 */

const DAY = 86400000;

export type DailyBrief = { day: string; title: string; body: string; highlights: string[]; at: number };

export async function getDailyBrief(): Promise<DailyBrief | null> {
  try {
    const b = JSON.parse((await getSetting("daily_brief")) ?? "null") as DailyBrief | null;
    return b && b.day === isoDay() ? b : null;
  } catch { return null; }
}

const BriefSchema = z.object({
  title: z.string().describe("Saluto e sintesi della giornata in una riga, massimo 60 caratteri (es. «Buongiorno! Due scadenze e una riunione»)"),
  body: z.string().describe("Una o due frasi per la notifica: le cose più importanti di oggi"),
  highlights: z.array(z.string()).describe("2-5 punti brevi e concreti: cosa fare oggi, cosa scade, cosa aspetta in Inbox, eventuali attenzioni"),
});

/** Riepilogo del mattino scritto dall'IA (salvato in settings.daily_brief e mostrato nella Home). */
export async function morningBrief(): Promise<DailyBrief> {
  const today = await TOOL_BY_NAME.get("today")!.run({});
  const since = new Date(Date.now() - DAY);
  const recent = await db.select({ title: items.title, type: items.type }).from(items).where(and(eq(items.status, "memory"), gte(items.createdAt, since))).limit(15);
  const out = await callJSON<z.infer<typeof BriefSchema>>({
    tier: "smart", task: "riepilogo_mattino", name: "riepilogo_mattino", maxTokens: 1200,
    messages: [
      { role: "system", content: "Scrivi il riepilogo del mattino del Second Brain personale dell'utente, in italiano. Breve, concreto e incoraggiante; niente elenchi infiniti. Usa solo i dati forniti. Se la giornata è libera, dillo in modo positivo." },
      { role: "user", content: `<oggi>\n${JSON.stringify(today)}\n</oggi>\n<ultime_24_ore>\n${JSON.stringify(recent)}\n</ultime_24_ore>` },
    ],
    jsonSchema: z.toJSONSchema(BriefSchema),
    parse: (v) => BriefSchema.safeParse(v) as { success: true; data: z.infer<typeof BriefSchema> } | { success: false },
  });
  const brief: DailyBrief = { day: isoDay(), title: out.title.slice(0, 80), body: out.body.slice(0, 300), highlights: out.highlights.slice(0, 5), at: Date.now() };
  await setSetting("daily_brief", JSON.stringify(brief));
  await log("Riepilogo del mattino", null, brief.title);
  return brief;
}

/** Segnali calcolati dai dati: il materiale su cui l'IA sceglie i suggerimenti. */
async function signals() {
  const now = Date.now();
  const today = isoDay();
  const [mem, ps, pp, ip, ts, gs, ls] = await Promise.all([
    db.select({ id: items.id, title: items.title, type: items.type, tags: items.tags, projectId: items.projectId, createdAt: items.createdAt }).from(items).where(eq(items.status, "memory")).orderBy(desc(items.createdAt)),
    db.select().from(projects),
    db.select().from(people),
    db.select().from(itemPeople),
    db.select().from(tasks),
    db.select().from(goals),
    db.select().from(links).where(eq(links.kind, "conflict")),
  ]);

  // Note recenti senza progetto che condividono un tag: forse un progetto nuovo o da assegnare.
  const loose = mem.filter((i) => !i.projectId && now - i.createdAt.getTime() < 60 * DAY);
  const byTag = new Map<string, typeof loose>();
  for (const i of loose) for (const t of i.tags) byTag.set(t, [...(byTag.get(t) ?? []), i]);
  const clusters = [...byTag].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 4)
    .map(([tag, l]) => ({ tag, items: l.slice(0, 6).map((i) => ({ id: i.id, title: i.title })) }));

  // Persone non sentite da oltre 30 giorni con attività aperte o in progetti attivi.
  const lastSeen = new Map<string, number>();
  const memAt = new Map(mem.map((i) => [i.id, i.createdAt.getTime()]));
  for (const x of ip) { const at = memAt.get(x.itemId); if (at) lastSeen.set(x.personId, Math.max(lastSeen.get(x.personId) ?? 0, at)); }
  const openTasks = ts.filter((t) => !t.done);
  const quiet = pp.map((p) => {
    const at = lastSeen.get(p.id);
    const theirItems = new Set(ip.filter((x) => x.personId === p.id).map((x) => x.itemId));
    const pending = openTasks.filter((t) => t.sourceItemId && theirItems.has(t.sourceItemId));
    return { id: p.id, name: p.name, role: p.role, days: at ? Math.round((now - at) / DAY) : null, pendingTasks: pending.map((t) => ({ id: t.id, title: t.title })) };
  }).filter((p) => p.days != null && p.days > 30 && p.pendingTasks.length).slice(0, 4);

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

  return { today, clusters, quiet, stale, overdue, conflicts, week, projects: ps.filter((p) => p.status !== "Chiuso").map((p) => ({ id: p.id, name: p.name })) };
}

const InsightSchema = z.object({
  insights: z.array(z.object({
    kind: z.enum(["project", "follow_up", "stale", "overdue", "conflict", "weekly", "other"]),
    title: z.string().describe("Il suggerimento in una riga, concreto (es. «Tre note sul cantiere non hanno un progetto»)"),
    body: z.string().describe("Una o due frasi: perché conta e cosa proponi"),
    refs: z.array(z.string()).describe("id di elementi, progetti o persone citati"),
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

export type InsightRow = { id: string; kind: string; title: string; body: string; actions: CommandAction[]; names: Record<string, string>; refs: { id: string; title: string; href: string }[] };

/** Suggerimenti del giorno (sostituiscono quelli nuovi dei giorni precedenti). */
export async function generateInsights(): Promise<number> {
  const s = await signals();
  const empty = !s.clusters.length && !s.quiet.length && !s.stale.length && !s.overdue.length && !s.conflicts.length && !s.week;
  await db.update(insights).set({ status: "dismissed" }).where(eq(insights.status, "new"));
  if (empty) { await log("Suggerimenti", null, "Nessun segnale"); return 0; }

  const out = await callJSON<z.infer<typeof InsightLoose>>({
    tier: "smart", task: "suggerimenti", name: "suggerimenti", maxTokens: 3000,
    messages: [
      {
        role: "system",
        content: `Sei il Second Brain dell'utente e oggi proponi al massimo 4 suggerimenti utili, in italiano, a partire dai segnali calcolati sui suoi dati.
Tipi: project (note senza progetto con un tema comune: proponi create_project, poi update_item per assegnarle), follow_up (persona non sentita da tempo con cose in sospeso: proponi add_task "Sentire …"), stale (progetto fermo: proponi il prossimo passo come add_task), overdue (attività scadute da giorni: proponi set_task_due o complete_task), conflict (informazioni in conflitto da chiarire), weekly (il lunedì, bilancio della settimana in 2-3 frasi, senza azioni).
Scegli solo ciò che è davvero utile; meglio pochi suggerimenti buoni. Usa solo gli id presenti nei segnali. Le azioni verranno confermate dall'utente: compila solo i campi che servono, gli altri null.`,
      },
      { role: "user", content: `<segnali>\n${JSON.stringify(s)}\n</segnali>` },
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
  ]);
  const day = isoDay();
  let n = 0;
  for (const ins of out.insights.slice(0, 4)) {
    const actions = cleanActions(ins.actions, ctx);
    const refs = [...new Set(ins.refs)].filter((id) => titles.has(id)).slice(0, 6).map((id) => ({ id, title: titles.get(id)![0], href: titles.get(id)![1] }));
    const kind = ["project", "follow_up", "stale", "overdue", "conflict", "weekly"].includes(ins.kind) ? ins.kind : "other";
    await db.insert(insights).values({ id: newId("in"), day, kind, title: ins.title.slice(0, 140), body: ins.body.slice(0, 500), actions, refs, status: "new", createdAt: new Date() });
    n++;
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
  const names = Object.fromEntries([
    ...[...ctx.projects, ...ctx.people].map((x) => [x.id, x.name]),
    ...[...ctx.tasks, ...ctx.items, ...ctx.goals, ...extra].map((x) => [x.id, x.title]),
  ]);
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, actions: r.actions as CommandAction[], names, refs: r.refs }));
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
