import "server-only";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, newId, ready } from "./db";
import { attachments, goals, itemPeople, items, links, people, projects, tasks } from "./db/schema";
import { aiEnabled } from "./ai";
import type { ApiScope } from "./api-keys";
import { captureText } from "./capture";
import { executeActions } from "./commands";
import { dueInfo, isoDay, reminderFields, validTime } from "./format";
import { log } from "./pipeline";
import { searchMemory } from "./queries";
import { hybridSearch } from "./semantic";
import { getProfile, getSetting } from "./settings";
import { emit } from "./webhooks";

/** Errore da restituire al client (400/404) invece di un errore interno. */
export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type Args = Record<string, unknown>;
export type Tool = {
  name: string;
  title: string;
  description: string;
  scope: ApiScope;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run: (a: Args) => Promise<unknown>;
};

const str = (a: Args, k: string, required = false) => {
  const v = a[k];
  if (v == null || v === "") { if (required) throw new ApiError(`Parametro mancante: ${k}`); return undefined; }
  return String(v);
};
const num = (a: Args, k: string, def: number, max = 100) => Math.max(1, Math.min(max, Math.round(Number(a[k] ?? def)) || def));
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const refresh = () => revalidatePath("/", "layout");

async function names() {
  const [ps, pp] = await Promise.all([db.select({ id: projects.id, name: projects.name }).from(projects), db.select({ id: people.id, name: people.name }).from(people)]);
  return { project: new Map(ps.map((p) => [p.id, p.name])), person: new Map(pp.map((p) => [p.id, p.name])) };
}

export async function summarizeItems(rows: (typeof items.$inferSelect)[]) {
  if (!rows.length) return [];
  const n = await names();
  const ip = await db.select().from(itemPeople).where(inArray(itemPeople.itemId, rows.map((r) => r.id)));
  return rows.map((i) => ({
    id: i.id, title: i.title, type: i.type ?? "Nota", date: isoDay(i.createdAt), summary: i.summary, tags: i.tags,
    project: i.projectId ? n.project.get(i.projectId) ?? null : null,
    people: ip.filter((x) => x.itemId === i.id).map((x) => n.person.get(x.personId)).filter(Boolean),
    favorite: i.favorite,
  }));
}

function taskOut(t: typeof tasks.$inferSelect, projectName?: Map<string, string>) {
  return {
    id: t.id, title: t.title, done: t.done, due: t.due, time: t.time, reminder: t.remind != null ? (t.remind === 0 ? "all'orario" : `${t.remind} min prima`) : null,
    priority: ["", "alta", "media", "bassa"][t.prio] ?? "media", when: t.due ? dueInfo(t.due).label : null,
    projectId: t.projectId, project: t.projectId ? projectName?.get(t.projectId) ?? null : null, sourceItemId: t.sourceItemId,
  };
}

export const TOOLS: Tool[] = [
  {
    name: "today",
    title: "La giornata",
    description: "Panoramica di oggi: data, attività scadute e di oggi (con orari), prossime scadenze, catture in Inbox da confermare, obiettivi aperti. Usalo per domande come «cosa devo fare oggi?» o «com'è la mia giornata?».",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const today = isoDay();
      const n = await names();
      const [open, inbox, gs, profile] = await Promise.all([
        db.select().from(tasks).where(eq(tasks.done, false)),
        db.select({ id: items.id, title: items.title, status: items.status }).from(items).where(inArray(items.status, ["processing", "ready", "error"])).orderBy(desc(items.createdAt)),
        db.select().from(goals).where(eq(goals.done, false)),
        getProfile(),
      ]);
      const sorted = open.sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9") || (a.time ?? "99").localeCompare(b.time ?? "99"));
      return {
        user: profile.name || null,
        today,
        weekday: new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long" }).format(new Date()),
        overdue: sorted.filter((t) => t.due && t.due < today).map((t) => taskOut(t, n.project)),
        dueToday: sorted.filter((t) => t.due === today).map((t) => taskOut(t, n.project)),
        next7days: sorted.filter((t) => t.due && t.due > today && dueInfo(t.due).group === "week").map((t) => taskOut(t, n.project)),
        inboxToConfirm: inbox.map((i) => ({ id: i.id, title: i.title, status: i.status === "ready" ? "proposta pronta" : i.status === "error" ? "errore" : "in elaborazione" })),
        openGoals: gs.map((g) => ({ id: g.id, title: g.title, project: n.project.get(g.projectId) ?? null })),
      };
    },
  },
  {
    name: "search_memory",
    title: "Cerca nella memoria",
    description: "Ricerca negli elementi confermati della memoria (note, documenti, decisioni, riunioni…), per parole e per significato: trova anche testi che usano parole diverse. Restituisce titolo, tipo, data, sintesi, tag, progetto e persone. Poi usa get_item per leggere il contenuto completo.",
    scope: "read",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Parole da cercare" }, limit: { type: "number", description: "Massimo risultati (predefinito 10, max 50)" } }, required: ["query"] },
    run: async (a) => {
      const q = str(a, "query", true)!;
      const limit = num(a, "limit", 10, 50);
      let ids = await hybridSearch(q, limit).catch(() => searchMemory(q, limit));
      if (!ids.length) {
        const rows = await db.select({ id: items.id }).from(items).where(and(eq(items.status, "memory"), or(like(items.title, `%${q}%`), like(items.content, `%${q}%`)))).limit(limit);
        ids = rows.map((r) => r.id);
      }
      if (!ids.length) return { results: [] };
      const rows = await db.select().from(items).where(inArray(items.id, ids));
      const order = new Map(ids.map((id, i) => [id, i]));
      return { results: await summarizeItems(rows.sort((x, y) => order.get(x.id)! - order.get(y.id)!)) };
    },
  },
  {
    name: "get_item",
    title: "Leggi un elemento",
    description: "Contenuto completo di un elemento della memoria (o dell'Inbox), con collegamenti, persone, progetto e allegati.",
    scope: "read",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (a) => {
      const id = str(a, "id", true)!;
      const [i] = await db.select().from(items).where(eq(items.id, id));
      if (!i) throw new ApiError("Elemento non trovato.", 404);
      const [base] = await summarizeItems([i]);
      const ls = await db.select().from(links).where(or(eq(links.fromId, id), eq(links.toId, id)));
      const others = ls.length ? await db.select({ id: items.id, title: items.title }).from(items).where(inArray(items.id, ls.map((l) => (l.fromId === id ? l.toId : l.fromId)))) : [];
      const att = await db.select({ name: attachments.name, mime: attachments.mime }).from(attachments).where(eq(attachments.itemId, id));
      return {
        ...base, status: i.status, source: i.source, content: i.content,
        links: ls.map((l) => { const o = l.fromId === id ? l.toId : l.fromId; return { id: o, title: others.find((x) => x.id === o)?.title ?? null, conflict: l.kind === "conflict", reason: l.reason }; }),
        attachments: att,
      };
    },
  },
  {
    name: "recent_items",
    title: "Elementi recenti",
    description: "Gli ultimi elementi confermati in memoria, dal più recente. Facoltativo: filtra per tipo (Nota, Idea, Decisione, Riunione, Documento, Pagina web, Attività).",
    scope: "read",
    inputSchema: { type: "object", properties: { limit: { type: "number" }, type: { type: "string" } } },
    run: async (a) => {
      const type = str(a, "type");
      const rows = await db.select().from(items).where(type ? and(eq(items.status, "memory"), eq(items.type, type as never)) : eq(items.status, "memory")).orderBy(desc(items.createdAt)).limit(num(a, "limit", 10, 50));
      return { items: await summarizeItems(rows) };
    },
  },
  {
    name: "ask_memory",
    title: "Chiedi alla memoria",
    description: "Fa rispondere l'assistente di Second Brain a una domanda, leggendo la memoria e citando le fonti. Utile per domande di sintesi («cosa abbiamo deciso su…?»). Ambito facoltativo: all, recent (30 giorni), project:<id>, person:<id>.",
    scope: "read",
    inputSchema: { type: "object", properties: { question: { type: "string" }, scope: { type: "string" } }, required: ["question"] },
    run: async (a) => {
      if (!(await aiEnabled())) throw new ApiError("L'IA di Second Brain non è configurata.", 503);
      const q = str(a, "question", true)!;
      const { runAgent } = await import("./agent");
      const r = await runAgent({ question: q, scope: str(a, "scope") ?? "all" });
      await log("API: domanda alla memoria", null, `${r.steps.length} passi · ${r.sources.length} fonti citate`);
      const rows = r.sources.length ? await db.select({ id: items.id, title: items.title }).from(items).where(inArray(items.id, r.sources)) : [];
      return { answer: r.text.replace(/⟦[^⟧]*⟧/g, "").replace(/ +([.,;:])/g, "$1"), note: r.note || null, sources: rows, steps: r.steps };
    },
  },
  {
    name: "capture",
    title: "Cattura in Inbox",
    description: "Salva una nota, un'idea, un resoconto o un link nell'Inbox di Second Brain. L'IA la classifica e l'utente la conferma nell'app prima che entri in memoria.",
    scope: "write",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "Contenuto completo" }, title: { type: "string", description: "Titolo facoltativo" } }, required: ["text"] },
    run: async (a) => {
      const text = str(a, "text", true)!.trim().slice(0, 50000);
      const isLink = /^https?:\/\/\S+$/.test(text);
      const id = await captureText(text, { kind: isLink ? "link" : "note", source: "Claude", title: str(a, "title"), wait: false });
      await log("API: cattura", id, "In Inbox");
      refresh();
      return { id, status: "in Inbox, in elaborazione", message: "Catturato. L'utente la conferma dall'Inbox dell'app." };
    },
  },
  {
    name: "list_tasks",
    title: "Elenca le attività",
    description: "Attività aperte (predefinito), completate o tutte, ordinate per scadenza. Filtro facoltativo per progetto.",
    scope: "read",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["open", "done", "all"] }, projectId: { type: "string" }, limit: { type: "number" } } },
    run: async (a) => {
      const status = str(a, "status") ?? "open";
      const pid = str(a, "projectId");
      const conds = [status === "open" ? eq(tasks.done, false) : status === "done" ? eq(tasks.done, true) : undefined, pid ? eq(tasks.projectId, pid) : undefined].filter(Boolean);
      const rows = await db.select().from(tasks).where(conds.length ? and(...(conds as never[])) : undefined).orderBy(tasks.due).limit(num(a, "limit", 50, 200));
      const n = await names();
      return { tasks: rows.map((t) => taskOut(t, n.project)) };
    },
  },
  {
    name: "add_task",
    title: "Nuova attività",
    description: "Crea un'attività. Data in YYYY-MM-DD, orario in HH:MM (fuso Europe/Rome); con un orario si può chiedere un promemoria (minuti di anticipo, 0 = all'orario) che arriva come notifica sul telefono.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string", description: "HH:MM" },
        reminder: { type: "number", description: "Minuti di anticipo del promemoria (0 = all'orario)" }, projectId: { type: "string" },
        priority: { type: "string", enum: ["alta", "media", "bassa"] },
      },
      required: ["title"],
    },
    run: async (a) => {
      const title = str(a, "title", true)!.trim().slice(0, 300);
      const due = day(str(a, "due")) ?? null;
      const time = validTime(str(a, "time"));
      const projectId = str(a, "projectId") ?? null;
      if (projectId && !(await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId))).length) throw new ApiError("Progetto non trovato.", 404);
      const prio = { alta: 1, media: 2, bassa: 3 }[str(a, "priority") ?? "media"] ?? 2;
      const id = newId("ta");
      await db.insert(tasks).values({ id, title, projectId, prio, due, createdAt: new Date(), ...reminderFields(due, time, time ? Number(a.reminder ?? 0) : null) });
      await log(`API: attività «${title}»`, null, "Creata");
      emit("task.created", { id, title, due, time, projectId });
      refresh();
      const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
      return { task: taskOut(t!) };
    },
  },
  {
    name: "update_task",
    title: "Modifica un'attività",
    description: "Completa, riapre o modifica un'attività esistente (titolo, data, orario, promemoria, priorità, progetto).",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }, done: { type: "boolean" }, title: { type: "string" }, due: { type: "string" }, time: { type: "string" },
        reminder: { type: "number" }, priority: { type: "string", enum: ["alta", "media", "bassa"] }, projectId: { type: "string" },
      },
      required: ["id"],
    },
    run: async (a) => {
      const id = str(a, "id", true)!;
      const [cur] = await db.select().from(tasks).where(eq(tasks.id, id));
      if (!cur) throw new ApiError("Attività non trovata.", 404);
      const patch: Partial<typeof tasks.$inferInsert> = {};
      if (typeof a.done === "boolean") patch.done = a.done;
      if (str(a, "title")) patch.title = str(a, "title")!.trim();
      if (str(a, "priority")) patch.prio = { alta: 1, media: 2, bassa: 3 }[str(a, "priority")!] ?? cur.prio;
      if (a.projectId !== undefined) patch.projectId = str(a, "projectId") ?? null;
      if (a.due !== undefined || a.time !== undefined || a.reminder !== undefined) {
        const due = a.due !== undefined ? day(str(a, "due")) ?? null : cur.due;
        const time = a.time !== undefined ? validTime(str(a, "time")) : cur.time;
        const remind = a.reminder !== undefined ? Number(a.reminder) : time ? cur.remind ?? 0 : null;
        Object.assign(patch, { due, ...reminderFields(due, time, remind) });
      }
      if (!Object.keys(patch).length) throw new ApiError("Niente da modificare.");
      await db.update(tasks).set(patch).where(eq(tasks.id, id));
      await log(`API: attività «${cur.title}»`, null, patch.done === true ? "Completata" : "Modificata");
      if (patch.done === true && !cur.done) emit("task.completed", { id, title: cur.title });
      refresh();
      const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
      return { task: taskOut(t!) };
    },
  },
  {
    name: "list_projects",
    title: "Elenca i progetti",
    description: "Progetti con stato, avanzamento, prossima milestone e obiettivi aperti.",
    scope: "read",
    inputSchema: { type: "object", properties: { status: { type: "string", enum: ["Attivo", "In pausa", "Chiuso"] } } },
    run: async (a) => {
      const status = str(a, "status");
      const [ps, gs, ts] = await Promise.all([db.select().from(projects), db.select().from(goals), db.select().from(tasks).where(eq(tasks.done, false))]);
      return {
        projects: ps.filter((p) => !status || p.status === status).map((p) => ({
          id: p.id, name: p.name, status: p.status, progress: p.pct, next: p.next, description: p.description,
          openGoals: gs.filter((g) => g.projectId === p.id && !g.done).map((g) => g.title),
          openTasks: ts.filter((t) => t.projectId === p.id).length,
        })),
      };
    },
  },
  {
    name: "get_project",
    title: "Dettaglio progetto",
    description: "Tutto su un progetto: obiettivi, attività, documenti, persone coinvolte e l'ultima sintesi «Cosa dovresti sapere», se generata.",
    scope: "read",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (a) => {
      const id = str(a, "id", true)!;
      const [p] = await db.select().from(projects).where(eq(projects.id, id));
      if (!p) throw new ApiError("Progetto non trovato.", 404);
      const [gs, ts, docs, brief] = await Promise.all([
        db.select().from(goals).where(eq(goals.projectId, id)).orderBy(goals.ord),
        db.select().from(tasks).where(eq(tasks.projectId, id)).orderBy(tasks.done, tasks.due),
        db.select().from(items).where(and(eq(items.projectId, id), eq(items.status, "memory"))).orderBy(desc(items.createdAt)).limit(30),
        getSetting(`brief:project:${id}`),
      ]);
      const summarized = await summarizeItems(docs);
      return {
        id: p.id, name: p.name, status: p.status, progress: p.pct, next: p.next, description: p.description,
        goals: gs.map((g) => ({ id: g.id, title: g.title, reached: g.done })),
        tasks: ts.map((t) => taskOut(t)),
        documents: summarized,
        people: [...new Set(summarized.flatMap((d) => d.people))],
        brief: brief ? JSON.parse(brief) : null,
      };
    },
  },
  {
    name: "list_people",
    title: "Elenca le persone",
    description: "Persone della memoria con ruolo, organizzazione ed email. Filtro facoltativo per nome.",
    scope: "read",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    run: async (a) => {
      const q = str(a, "query")?.toLowerCase();
      const pp = await db.select().from(people).orderBy(people.name);
      return { people: pp.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => ({ id: p.id, name: p.name, role: p.role, org: p.org, email: p.email })) };
    },
  },
  {
    name: "get_person",
    title: "Dettaglio persona",
    description: "Una persona: dati, note personali, elementi in cui compare, progetti comuni e l'ultima «Relazione in breve», se generata.",
    scope: "read",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (a) => {
      const id = str(a, "id", true)!;
      const [p] = await db.select().from(people).where(eq(people.id, id));
      if (!p) throw new ApiError("Persona non trovata.", 404);
      const rows = await db.select({ item: items }).from(itemPeople).innerJoin(items, eq(itemPeople.itemId, items.id)).where(and(eq(itemPeople.personId, id), eq(items.status, "memory"))).orderBy(desc(items.createdAt)).limit(30);
      const brief = await getSetting(`brief:person:${id}`);
      const summarized = await summarizeItems(rows.map((r) => r.item));
      return {
        id: p.id, name: p.name, role: p.role, org: p.org, email: p.email, note: p.note,
        items: summarized, projects: [...new Set(summarized.map((i) => i.project).filter(Boolean))],
        brief: brief ? JSON.parse(brief) : null,
      };
    },
  },
  {
    name: "run_command",
    title: "Comando in linguaggio naturale",
    description: "Interpreta una richiesta in italiano come fa la barra comandi dell'app (catture, attività con orari e promemoria, progetti, obiettivi, persone, modifiche e collegamenti tra elementi). Con execute=false (predefinito) restituisce solo le azioni proposte: mostrale all'utente e, dopo la sua conferma, ripeti la chiamata con execute=true.",
    scope: "write",
    inputSchema: { type: "object", properties: { text: { type: "string" }, execute: { type: "boolean", description: "true per eseguire subito le azioni proposte" } }, required: ["text"] },
    run: async (a) => {
      if (!(await aiEnabled())) throw new ApiError("L'IA di Second Brain non è configurata.", 503);
      const { runAgent } = await import("./agent");
      const res = await runAgent({ question: str(a, "text", true)!, mode: "command" });
      const proposed = res.actions.map((x) => ({ kind: x.kind, label: x.label }));
      if (a.execute !== true) return { executed: false, actions: proposed, reply: res.actions.length ? undefined : res.text.replace(/⟦[^⟧]*⟧/g, ""), message: proposed.length ? "Azioni proposte: chiedi conferma all'utente, poi richiama con execute=true." : "Nessuna azione riconosciuta." };
      const n = await executeActions(res.actions, "api");
      refresh();
      return { executed: true, count: n, actions: proposed };
    },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Esegue uno strumento (dopo il controllo della chiave). */
export async function runTool(name: string, args: Args) {
  await ready();
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) throw new ApiError(`Strumento sconosciuto: ${name}`, 404);
  return tool.run(args ?? {});
}
