import "server-only";
import { desc, eq, inArray, or } from "drizzle-orm";
import { db } from "./db";
import { aimItems, aims, chats, goals, itemPeople, items, links, people, projects, tasks } from "./db/schema";
import { isoDay } from "./format";
import { resolveSubject } from "./overview";

/**
 * Il percorso delle relazioni attorno a un progetto, una persona o un obiettivo personale, in una sola lettura:
 * attività aperte (scadute, ferme) → persone coinvolte (da quanto non se ne sa nulla) → ultime riunioni e note →
 * documenti e decisioni → conflitti. Più le «prove»: frasi già calcolate dal codice, con l'id dell'elemento da citare.
 * Serve all'Assistente per rispondere a «perché X è fermo?», «cosa blocca…?», «chi aspetta cosa?» senza 5 passi di ricerca.
 */

const DAY = 86400000;
const days = (from: number, to = Date.now()) => Math.max(0, Math.round((to - from) / DAY));
const ago = (n: number) => (n === 0 ? "oggi" : n === 1 ? "ieri" : `${n} giorni fa`);
const nDays = (n: number) => (n === 1 ? "1 giorno" : `${n} giorni`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const CONVERSATIONS = new Set(["Riunione", "Nota", "Audio", "Idea"]);
const DOCUMENTS = new Set(["Documento", "Pagina web"]);

type Row = typeof items.$inferSelect;
export type Evidence = { text: string; id?: string };

export async function traceRelations(args: { id?: string; name?: string }) {
  let subject: { kind: "project" | "person" | "aim"; id: string; name: string } | null = null;
  const id = String(args.id ?? "").trim();
  if (id) {
    const [[p], [pe], [a]] = await Promise.all([
      db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, id)),
      db.select({ id: people.id, name: people.name }).from(people).where(eq(people.id, id)),
      db.select({ id: aims.id, name: aims.title }).from(aims).where(eq(aims.id, id)),
    ]);
    subject = p ? { kind: "project", ...p } : pe ? { kind: "person", ...pe } : a ? { kind: "aim", ...a } : null;
  }
  if (!subject && args.name) subject = await resolveSubject(String(args.name));
  if (!subject) return { error: "Non trovo un progetto, una persona o un obiettivo con questo nome o id. Usa search_memory per gli argomenti liberi." };

  const now = Date.now();
  const today = isoDay();
  const [mem, pp, ip, allTasks] = await Promise.all([
    db.select().from(items).where(eq(items.status, "memory")).orderBy(desc(items.createdAt)),
    db.select().from(people),
    db.select().from(itemPeople),
    db.select().from(tasks),
  ]);
  const memById = new Map(mem.map((i) => [i.id, i]));

  // Elementi e attività del soggetto.
  let its: Row[] = [];
  let ts: (typeof tasks.$inferSelect)[] = [];
  const info: Record<string, unknown> = {};
  if (subject.kind === "project") {
    const [p] = await db.select().from(projects).where(eq(projects.id, subject.id));
    its = mem.filter((i) => i.projectId === subject!.id);
    ts = allTasks.filter((t) => t.projectId === subject!.id);
    const gs = await db.select().from(goals).where(eq(goals.projectId, subject.id));
    Object.assign(info, { status: p.status, pct: p.pct, next: p.next || null, description: p.description || null, goals: gs.map((g) => ({ title: g.title, reached: g.done })) });
  } else if (subject.kind === "person") {
    const [pe] = await db.select().from(people).where(eq(people.id, subject.id));
    const mine = new Set(ip.filter((x) => x.personId === subject!.id).map((x) => x.itemId));
    its = mem.filter((i) => mine.has(i.id));
    ts = allTasks.filter((t) => t.sourceItemId && mine.has(t.sourceItemId));
    const projIds = [...new Set(its.map((i) => i.projectId).filter((x): x is string => !!x))];
    const ps = projIds.length ? await db.select().from(projects).where(inArray(projects.id, projIds)) : [];
    Object.assign(info, { role: pe.role || null, org: pe.org || null, note: pe.note.slice(0, 400) || null, projects: ps.map((p) => ({ id: p.id, name: p.name, status: p.status, pct: p.pct })) });
  } else {
    const [a] = await db.select().from(aims).where(eq(aims.id, subject.id));
    const linked = new Set((await db.select().from(aimItems).where(eq(aimItems.aimId, subject.id))).map((x) => x.itemId));
    its = mem.filter((i) => linked.has(i.id));
    ts = allTasks.filter((t) => t.aimId === subject!.id);
    Object.assign(info, { status: a.status, due: a.due, description: a.description || null, daysLeft: a.due ? Math.round((Date.parse(a.due) - Date.parse(today)) / DAY) : null });
  }
  // Anche le attività nate dagli elementi del soggetto.
  const itemIds = new Set(its.map((i) => i.id));
  for (const t of allTasks) if (t.sourceItemId && itemIds.has(t.sourceItemId) && !ts.some((x) => x.id === t.id)) ts.push(t);

  const open = ts.filter((t) => !t.done);
  const peopleOf = (itemId: string | null) => (itemId ? ip.filter((x) => x.itemId === itemId).map((x) => pp.find((p) => p.id === x.personId)?.name).filter(Boolean) as string[] : []);
  const openTasks = open.map((t) => ({
    id: t.id, title: t.title, due: t.due, overdueDays: t.due && t.due < today ? Math.round((Date.parse(today) - Date.parse(t.due)) / DAY) : 0,
    ageDays: days(t.createdAt.getTime()), fromItem: t.sourceItemId && memById.has(t.sourceItemId) ? { id: t.sourceItemId, title: memById.get(t.sourceItemId)!.title } : null,
    waitingOn: peopleOf(t.sourceItemId),
  })).sort((a, b) => b.overdueDays - a.overdueDays || b.ageDays - a.ageDays).slice(0, 15);
  const doneRecently = ts.filter((t) => t.done).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 5).map((t) => ({ id: t.id, title: t.title }));

  // Persone coinvolte: da quando non compaiono in un elemento (in tutta la memoria, non solo qui).
  const lastSeen = new Map<string, number>();
  for (const x of ip) { const i = memById.get(x.itemId); if (i) lastSeen.set(x.personId, Math.max(lastSeen.get(x.personId) ?? 0, i.createdAt.getTime())); }
  const involvedIds = subject.kind === "person" ? [] : [...new Set(ip.filter((x) => itemIds.has(x.itemId)).map((x) => x.personId))];
  const involved = involvedIds.map((pid) => {
    const p = pp.find((x) => x.id === pid)!;
    return { id: pid, name: p.name, role: p.role || null, daysSinceLastNews: lastSeen.has(pid) ? days(lastSeen.get(pid)!) : null, openTasksFromTheirItems: openTasks.filter((t) => t.waitingOn.includes(p.name)).length };
  }).sort((a, b) => (b.daysSinceLastNews ?? 0) - (a.daysSinceLastNews ?? 0)).slice(0, 10);

  const brief = (i: Row) => ({ id: i.id, title: i.title, type: i.type ?? "Nota", date: isoDay(i.createdAt), summary: (i.summary ?? i.content).slice(0, 260), people: peopleOf(i.id) });
  const conversations = its.filter((i) => CONVERSATIONS.has(i.type ?? "Nota")).slice(0, 5).map(brief);
  const documents = its.filter((i) => DOCUMENTS.has(i.type ?? "")).slice(0, 5).map(brief);
  const decisions = its.filter((i) => i.type === "Decisione").slice(0, 5).map(brief);
  const conflictRows = itemIds.size ? await db.select().from(links).where(or(inArray(links.fromId, [...itemIds]), inArray(links.toId, [...itemIds]))) : [];
  const conflicts = conflictRows.filter((l) => l.kind === "conflict" && memById.has(l.fromId) && memById.has(l.toId))
    .map((l) => ({ a: { id: l.fromId, title: memById.get(l.fromId)!.title }, b: { id: l.toId, title: memById.get(l.toId)!.title }, reason: l.reason })).slice(0, 5);
  // Conversazioni con l'Assistente che ne parlano (titolo = prima domanda).
  const words = subject.name.toLowerCase();
  const chatRows = (await db.select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt }).from(chats).orderBy(desc(chats.updatedAt)).limit(200))
    .filter((c) => c.title.toLowerCase().includes(words)).slice(0, 3).map((c) => ({ title: c.title, date: isoDay(c.updatedAt) }));

  // Le prove: fatti misurati, ognuno con l'elemento da citare quando c'è.
  const lastItem = its[0];
  const lastTask = [...ts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const lastActivity = Math.max(lastItem?.createdAt.getTime() ?? 0, lastTask?.createdAt.getTime() ?? 0);
  const evidence: Evidence[] = [];
  if (lastActivity) evidence.push({ text: `Ultima novità ${ago(days(lastActivity))} (${lastItem && lastItem.createdAt.getTime() === lastActivity ? `«${lastItem.title}»` : `attività «${lastTask!.title}»`})`, id: lastItem && lastItem.createdAt.getTime() === lastActivity ? lastItem.id : undefined });
  else evidence.push({ text: "Nessun elemento né attività collegati" });
  const overdue = openTasks.filter((t) => t.overdueDays > 0);
  if (overdue.length) evidence.push({ text: `${plural(overdue.length, "attività scaduta", "attività scadute")}${overdue.length > 1 ? ", la più vecchia" : ":"} «${overdue[0].title}» da ${nDays(overdue[0].overdueDays)}` });
  const oldOpen = openTasks.filter((t) => !t.overdueDays && t.ageDays >= 21);
  if (oldOpen.length) evidence.push({ text: `${plural(oldOpen.length, "attività aperta", "attività aperte")} da oltre 3 settimane e non ancora scadute (es. «${oldOpen[0].title}», da ${nDays(oldOpen[0].ageDays)})` });
  if (!open.length && subject.kind !== "person") evidence.push({ text: "Nessuna attività aperta: manca un prossimo passo" });
  for (const p of involved.filter((x) => (x.daysSinceLastNews ?? 0) >= 21).slice(0, 3)) evidence.push({ text: `Nessuna novità da ${p.name}${p.role ? ` (${p.role})` : ""} da ${nDays(p.daysSinceLastNews!)}${p.openTasksFromTheirItems ? `, con ${plural(p.openTasksFromTheirItems, "attività aperta legata", "attività aperte legate")} a quella persona` : ""}` });
  for (const t of openTasks.filter((x) => x.fromItem && x.waitingOn.length).slice(0, 3)) evidence.push({ text: `«${t.title}» nasce da «${t.fromItem!.title}» con ${t.waitingOn.join(", ")}`, id: t.fromItem!.id });
  for (const c of conflicts.slice(0, 2)) evidence.push({ text: `«${c.a.title}» e «${c.b.title}» si contraddicono${c.reason ? `: ${c.reason}` : ""}`, id: c.a.id });
  if (decisions[0]) evidence.push({ text: `Ultima decisione: «${decisions[0].title}» del ${decisions[0].date}`, id: decisions[0].id });
  if (typeof info.pct === "number" && info.next) evidence.push({ text: `Avanzamento ${info.pct}%, prossima milestone: ${info.next}` });
  if (typeof info.daysLeft === "number") evidence.push({ text: info.daysLeft < 0 ? `Scadenza dell'obiettivo superata da ${nDays(-info.daysLeft)}` : info.daysLeft === 0 ? "L'obiettivo scade oggi" : `${info.daysLeft === 1 ? "Manca 1 giorno" : `Mancano ${info.daysLeft} giorni`} alla scadenza dell'obiettivo` });

  return {
    subject: { kind: subject.kind, id: subject.id, name: subject.name, ...info },
    lastActivityDays: lastActivity ? days(lastActivity) : null,
    evidence,
    openTasks, doneRecently, people: involved, conversations, documents, decisions, conflicts, assistantChats: chatRows,
    counts: { items: its.length, openTasks: open.length, doneTasks: ts.length - open.length },
    note: "Rispondi seguendo il percorso (attività → persone → conversazioni → documenti) e porta le prove; cita gli elementi con ⟦id⟧.",
  };
}
