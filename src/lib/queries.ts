import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, ready } from "./db";
import { aiLog, attachments, goals, itemPeople, items, links, people, projects, tasks, type Item } from "./db/schema";
import type { CommandContext, MemoryContext } from "./ai";
import { isoDay } from "./format";

const INBOX_STATUSES = ["processing", "ready", "error"] as const;

export async function getInbox() {
  await ready();
  return db.select().from(items).where(inArray(items.status, [...INBOX_STATUSES])).orderBy(desc(items.createdAt));
}

export async function getInboxCount() {
  await ready();
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(items).where(inArray(items.status, [...INBOX_STATUSES]));
  return r?.n ?? 0;
}

export type MemoryRow = Item & { linkCount: number; conflict: boolean };

export async function getMemory(): Promise<MemoryRow[]> {
  await ready();
  const rows = await db.select().from(items).where(eq(items.status, "memory")).orderBy(desc(items.createdAt));
  const allLinks = await db.select().from(links);
  const count = new Map<string, number>();
  const conflict = new Set<string>();
  for (const l of allLinks) {
    count.set(l.fromId, (count.get(l.fromId) ?? 0) + 1);
    count.set(l.toId, (count.get(l.toId) ?? 0) + 1);
    // Il conflitto è segnalato sull'elemento più recente, quello che contraddice.
    if (l.kind === "conflict") conflict.add(l.fromId);
  }
  return rows.map((r) => ({ ...r, linkCount: count.get(r.id) ?? 0, conflict: conflict.has(r.id) }));
}

export async function getItemDetail(id: string) {
  await ready();
  const [item] = await db.select().from(items).where(eq(items.id, id));
  if (!item) return null;
  const [project] = item.projectId ? await db.select().from(projects).where(eq(projects.id, item.projectId)) : [];
  const persons = await db
    .select({ id: people.id, name: people.name, role: people.role })
    .from(itemPeople)
    .innerJoin(people, eq(itemPeople.personId, people.id))
    .where(eq(itemPeople.itemId, id));
  const linkRows = await db.select().from(links).where(or(eq(links.fromId, id), eq(links.toId, id)));
  const otherIds = linkRows.map((l) => (l.fromId === id ? l.toId : l.fromId));
  const linked = otherIds.length
    ? await db.select().from(items).where(and(inArray(items.id, otherIds), eq(items.status, "memory")))
    : [];
  const linkedView = linked.map((o) => {
    const l = linkRows.find((x) => x.fromId === o.id || x.toId === o.id)!;
    return { id: o.id, title: o.title, type: o.type, createdAt: o.createdAt, kind: l.kind, reason: l.reason };
  });
  const itemTasks = await db
    .select()
    .from(tasks)
    .where(item.projectId ? or(eq(tasks.sourceItemId, id), eq(tasks.projectId, item.projectId)) : eq(tasks.sourceItemId, id))
    .limit(4);
  const log = await db.select().from(aiLog).where(eq(aiLog.itemId, id)).orderBy(desc(aiLog.at)).limit(8);
  return { item, project: project ?? null, persons, linked: linkedView, tasks: itemTasks, log };
}

export async function getAttachments(itemId: string) {
  await ready();
  return db.select().from(attachments).where(eq(attachments.itemId, itemId));
}

export async function getProjects() {
  await ready();
  return db.select().from(projects);
}

export async function getPeople() {
  await ready();
  return db.select().from(people);
}

export async function getTasks() {
  await ready();
  return db.select().from(tasks).orderBy(tasks.due);
}

export async function getAiLog(limit = 50) {
  await ready();
  return db.select().from(aiLog).orderBy(desc(aiLog.at)).limit(limit);
}

/** Titoli degli elementi sorgente delle attività, per "da …". */
export async function getItemTitles(ids: string[]) {
  if (!ids.length) return new Map<string, { title: string; type: string | null; createdAt: Date }>();
  const rows = await db.select({ id: items.id, title: items.title, type: items.type, createdAt: items.createdAt }).from(items).where(inArray(items.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Contesto compatto della memoria da passare all'IA durante la classificazione. */
export async function memoryContext(excludeId?: string): Promise<MemoryContext> {
  await ready();
  const [ps, pp, its] = await Promise.all([
    db.select({ id: projects.id, name: projects.name, description: projects.description }).from(projects),
    db.select({ name: people.name, role: people.role }).from(people),
    db
      .select({ id: items.id, type: items.type, title: items.title, summary: items.summary, createdAt: items.createdAt })
      .from(items)
      .where(eq(items.status, "memory"))
      .orderBy(desc(items.createdAt))
      .limit(80),
  ]);
  return {
    projects: ps,
    people: pp,
    items: its
      .filter((i) => i.id !== excludeId)
      .map((i) => ({ id: i.id, type: i.type, title: i.title, summary: i.summary, date: i.createdAt.toISOString().slice(0, 10) })),
  };
}

// ——— Progetti ———

export async function getProjectsOverview() {
  await ready();
  const [ps, its, ts, ip] = await Promise.all([
    db.select().from(projects),
    db.select({ id: items.id, projectId: items.projectId }).from(items).where(eq(items.status, "memory")),
    db.select({ projectId: tasks.projectId, done: tasks.done }).from(tasks),
    db.select({ itemId: itemPeople.itemId, name: people.name }).from(itemPeople).innerJoin(people, eq(itemPeople.personId, people.id)),
  ]);
  return ps.map((p) => {
    const ids = new Set(its.filter((i) => i.projectId === p.id).map((i) => i.id));
    const pt = ts.filter((t) => t.projectId === p.id);
    const names = [...new Set(ip.filter((x) => ids.has(x.itemId)).map((x) => x.name))];
    return { ...p, items: ids.size, openTasks: pt.filter((t) => !t.done).length, people: names };
  });
}

export async function getProjectDetail(id: string) {
  await ready();
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) return null;
  const docs = await db.select().from(items).where(and(eq(items.projectId, id), eq(items.status, "memory"))).orderBy(desc(items.createdAt));
  const projTasks = await db.select().from(tasks).where(eq(tasks.projectId, id)).orderBy(tasks.done, tasks.due);
  const projGoals = await db.select().from(goals).where(eq(goals.projectId, id)).orderBy(goals.ord, goals.createdAt);
  const ids = docs.map((d) => d.id);
  const persons = ids.length
    ? await db
        .selectDistinct({ id: people.id, name: people.name, role: people.role })
        .from(itemPeople)
        .innerJoin(people, eq(itemPeople.personId, people.id))
        .where(inArray(itemPeople.itemId, ids))
    : [];
  return { project, docs, tasks: projTasks, persons, goals: projGoals };
}

// ——— Persone ———

export async function getPeopleOverview() {
  await ready();
  const [ps, ip] = await Promise.all([
    db.select().from(people).orderBy(people.name),
    db
      .select({ personId: itemPeople.personId, createdAt: items.createdAt })
      .from(itemPeople)
      .innerJoin(items, eq(itemPeople.itemId, items.id))
      .where(eq(items.status, "memory")),
  ]);
  return ps.map((p) => {
    const mine = ip.filter((x) => x.personId === p.id);
    const last = mine.reduce<Date | null>((m, x) => (!m || x.createdAt > m ? x.createdAt : m), null);
    return { ...p, items: mine.length, last };
  });
}

export async function getPersonDetail(id: string) {
  await ready();
  const [person] = await db.select().from(people).where(eq(people.id, id));
  if (!person) return null;
  const its = await db
    .select({ id: items.id, title: items.title, type: items.type, kind: items.kind, createdAt: items.createdAt, projectId: items.projectId })
    .from(itemPeople)
    .innerJoin(items, eq(itemPeople.itemId, items.id))
    .where(and(eq(itemPeople.personId, id), eq(items.status, "memory")))
    .orderBy(desc(items.createdAt));
  const projIds = [...new Set(its.map((i) => i.projectId).filter((x): x is string => !!x))];
  const projs = projIds.length ? await db.select().from(projects).where(inArray(projects.id, projIds)) : [];
  return { person, items: its, projects: projs };
}

/** Contesto per l'interprete dei comandi: tutto ciò a cui un comando può riferirsi. */
export async function commandContext(): Promise<CommandContext> {
  await ready();
  const taskCols = { id: tasks.id, title: tasks.title, due: tasks.due, projectId: tasks.projectId, done: tasks.done };
  const [ps, pp, open, closed, its, gs] = await Promise.all([
    db.select({ id: projects.id, name: projects.name, status: projects.status, pct: projects.pct }).from(projects),
    db.select({ id: people.id, name: people.name, role: people.role, org: people.org }).from(people),
    db.select(taskCols).from(tasks).where(eq(tasks.done, false)),
    // Le ultime completate, per poterle riaprire.
    db.select(taskCols).from(tasks).where(eq(tasks.done, true)).orderBy(desc(tasks.createdAt)).limit(30),
    // Elementi in memoria a cui un comando può riferirsi: i 300 più recenti.
    db.select({ id: items.id, type: items.type, createdAt: items.createdAt, title: items.title, tags: items.tags })
      .from(items).where(eq(items.status, "memory")).orderBy(desc(items.createdAt)).limit(300),
    db.select({ id: goals.id, title: goals.title, projectId: goals.projectId, done: goals.done }).from(goals),
  ]);
  const weekday = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long" }).format(new Date());
  return {
    today: `${isoDay()} (${weekday})`, projects: ps, people: pp, tasks: [...open, ...closed], goals: gs,
    items: its.map(({ createdAt, ...i }) => ({ ...i, date: isoDay(createdAt) })),
  };
}

const STOP = new Set("il lo la i gli le un uno una di da in con su per tra fra a e o ma che chi cosa come dove quando quale quali quanto del della dei delle dello degli al alla ai alle allo agli dal dalla nel nella nei nelle sul sulla sui sulle mi ti si ci vi ne non piu più mio mia miei mie tuo tua suo sua nostro questo questa questi queste quello quella sono sei era ho hai ha abbiamo hanno essere avere fare fatto detto devo dobbiamo cosa ancora anche".split(" "));

/** Elementi della memoria che corrispondono alle parole della domanda (FTS5, ordinati per pertinenza). */
export async function searchMemory(text: string, limit = 150): Promise<string[]> {
  await ready();
  const words = [...new Set(text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((w) => !STOP.has(w));
  if (!words.length) return [];
  // Prefisso con radice corta: "progetti" trova anche "progetto".
  const match = words.slice(0, 12).map((w) => `"${w.length > 5 ? w.slice(0, w.length - 2) : w}"*`).join(" OR ");
  const rows = await db.all<{ id: string }>(sql`SELECT f.id AS id FROM items_fts f JOIN items i ON i.rowid = f.rowid WHERE items_fts MATCH ${match} AND i.status = 'memory' ORDER BY bm25(items_fts, 0, 5, 3, 1, 3) LIMIT ${limit}`);
  return rows.map((r) => r.id);
}


/** Opzioni di ambito per l'assistente. */
export async function askScopes() {
  await ready();
  const [ps, pp] = await Promise.all([
    db.select({ id: projects.id, name: projects.name, status: projects.status }).from(projects),
    db.select({ id: people.id, name: people.name }).from(people).orderBy(people.name),
  ]);
  return {
    projects: ps.filter((p) => p.status !== "Chiuso").map((p) => ({ id: p.id, name: p.name })),
    people: pp,
  };
}

// ——— Timeline e Connessioni ———

export type TimelineEvent = {
  id: string;
  kind: "decision" | "meeting" | "note" | "doc" | "task";
  title: string;
  detail: string | null;
  meta: string;
  at: string;
  href: string;
  conflict: string | null;
};

const TL_KIND: Record<string, TimelineEvent["kind"]> = { Decisione: "decision", Riunione: "meeting", Documento: "doc", "Pagina web": "doc", Attività: "task" };

export async function getTimeline(): Promise<TimelineEvent[]> {
  await ready();
  const [its, ts, ps, ls] = await Promise.all([
    db.select().from(items).where(eq(items.status, "memory")),
    db.select().from(tasks),
    db.select({ id: projects.id, name: projects.name }).from(projects),
    db.select().from(links).where(eq(links.kind, "conflict")),
  ]);
  const projName = new Map(ps.map((p) => [p.id, p.name]));
  const title = new Map(its.map((i) => [i.id, i.title]));
  const events: TimelineEvent[] = its.map((i) => {
    const c = ls.find((l) => l.fromId === i.id || l.toId === i.id);
    return {
      id: i.id,
      kind: TL_KIND[i.type ?? ""] ?? "note",
      title: i.title,
      detail: i.summary,
      meta: [i.type ?? "Nota", i.projectId ? projName.get(i.projectId) : null, i.origin].filter(Boolean).join(" · "),
      at: i.createdAt.toISOString(),
      href: `/conoscenza/${i.id}`,
      conflict: c ? `In conflitto con «${title.get(c.fromId === i.id ? c.toId : c.fromId) ?? "un altro elemento"}»` : null,
    };
  });
  for (const t of ts) {
    events.push({
      id: t.id,
      kind: "task",
      title: t.title,
      detail: null,
      meta: ["Attività creata", t.done ? "completata" : t.due ? `scadenza ${t.due}` : null, t.projectId ? projName.get(t.projectId) : null].filter(Boolean).join(" · "),
      at: t.createdAt.toISOString(),
      href: t.sourceItemId ? `/conoscenza/${t.sourceItemId}` : "/attivita",
      conflict: null,
    });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export type GraphNode = { id: string; type: "person" | "project" | "document" | "decision" | "concept" | "note" | "task" | "event"; label: string; desc: string; href: string | null };
export type GraphEdge = { a: string; b: string; conflict: boolean; reason: string };

const G_TYPE: Record<string, GraphNode["type"]> = { Decisione: "decision", Riunione: "event", Documento: "document", "Pagina web": "document", Attività: "task" };

export async function getGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  await ready();
  const [its, ps, pp, ip, ls, ts] = await Promise.all([
    db.select().from(items).where(eq(items.status, "memory")),
    db.select().from(projects),
    db.select().from(people),
    db.select().from(itemPeople),
    db.select().from(links),
    db.select().from(tasks).where(eq(tasks.done, false)),
  ]);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const has = new Set<string>();
  const add = (n: GraphNode) => { nodes.push(n); has.add(n.id); };
  const edge = (a: string, b: string, conflict = false, reason = "") => { if (has.has(a) && has.has(b)) edges.push({ a, b, conflict, reason }); };

  for (const p of ps) add({ id: p.id, type: "project", label: p.name, desc: [p.status, `${p.pct}%`, p.next].filter(Boolean).join(" · "), href: `/progetti/${p.id}` });
  const linkedPeople = new Set(ip.map((x) => x.personId));
  for (const p of pp) if (linkedPeople.has(p.id)) add({ id: p.id, type: "person", label: p.name, desc: [p.role, p.org].filter(Boolean).join(" · "), href: `/persone/${p.id}` });
  for (const i of its) add({ id: i.id, type: G_TYPE[i.type ?? ""] ?? "note", label: i.title, desc: i.summary ?? "", href: `/conoscenza/${i.id}` });

  // Concetti: i tag condivisi da almeno due elementi.
  const tagCount = new Map<string, number>();
  for (const i of its) for (const t of i.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  for (const [t, n] of tagCount) if (n >= 2) add({ id: "tag:" + t, type: "concept", label: "#" + t, desc: `${n} elementi`, href: null });

  for (const t of ts) if (t.projectId || t.sourceItemId) add({ id: t.id, type: "task", label: t.title, desc: t.due ? `Scadenza ${t.due}` : "Senza scadenza", href: t.sourceItemId ? `/conoscenza/${t.sourceItemId}` : "/attivita" });

  for (const i of its) {
    if (i.projectId) edge(i.id, i.projectId);
    for (const t of i.tags) edge(i.id, "tag:" + t);
  }
  for (const x of ip) edge(x.itemId, x.personId);
  for (const l of ls) edge(l.fromId, l.toId, l.kind === "conflict", l.reason);
  for (const t of ts) {
    if (t.sourceItemId) edge(t.id, t.sourceItemId);
    else if (t.projectId) edge(t.id, t.projectId);
  }
  return { nodes, edges };
}

/** Dati per la sintesi IA di un progetto o di una persona; `count` serve a capire se la sintesi salvata è superata. */
export async function briefData(kind: "project" | "person", id: string): Promise<{ data: unknown; count: number } | null> {
  await ready();
  const today = isoDay();
  const docOf = (i: Item) => ({ id: i.id, type: i.type, date: isoDay(i.createdAt), title: i.title, summary: i.summary, tags: i.tags, content: i.content.slice(0, 1500) });
  const conflictsAmong = async (ids: string[]) => {
    if (!ids.length) return [];
    const rows = await db.select().from(links).where(and(eq(links.kind, "conflict"), or(inArray(links.fromId, ids), inArray(links.toId, ids))));
    return rows.map((l) => ({ between: [l.fromId, l.toId], reason: l.reason }));
  };

  if (kind === "project") {
    const d = await getProjectDetail(id);
    if (!d) return null;
    const docs = d.docs.slice(0, 15);
    return {
      count: d.docs.length + d.tasks.length + d.goals.length,
      data: {
        today,
        project: { name: d.project.name, status: d.project.status, pct: d.project.pct, next: d.project.next, description: d.project.description },
        goals: d.goals.map((g) => ({ title: g.title, done: g.done })),
        people: d.persons.map((p) => ({ name: p.name, role: p.role })),
        tasks: d.tasks.map((t) => ({ title: t.title, due: t.due, done: t.done, prio: t.prio })),
        documents: docs.map(docOf),
        conflicts: await conflictsAmong(docs.map((x) => x.id)),
      },
    };
  }

  const [person] = await db.select().from(people).where(eq(people.id, id));
  if (!person) return null;
  const its = await db
    .select({ item: items })
    .from(itemPeople)
    .innerJoin(items, eq(itemPeople.itemId, items.id))
    .where(and(eq(itemPeople.personId, id), eq(items.status, "memory")))
    .orderBy(desc(items.createdAt));
  const list = its.map((r) => r.item);
  const projIds = [...new Set(list.map((i) => i.projectId).filter((x): x is string => !!x))];
  const [projs, openTasks] = await Promise.all([
    projIds.length ? db.select().from(projects).where(inArray(projects.id, projIds)) : [],
    list.length ? db.select().from(tasks).where(and(eq(tasks.done, false), inArray(tasks.sourceItemId, list.map((i) => i.id)))) : [],
  ]);
  return {
    count: list.length + (person.note ? 1 : 0),
    data: {
      today,
      person: { name: person.name, role: person.role, org: person.org, note: person.note },
      projects: projs.map((p) => ({ name: p.name, status: p.status, pct: p.pct, next: p.next })),
      openTasks: openTasks.map((t) => ({ title: t.title, due: t.due })),
      items: list.slice(0, 15).map(docOf),
      totalItems: list.length,
    },
  };
}
