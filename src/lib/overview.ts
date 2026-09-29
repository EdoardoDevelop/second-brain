import "server-only";
import { z } from "zod";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "./db";
import { aimItems, aims, goals, itemPeople, items, links, people, projects, tasks } from "./db/schema";
import { isoDay } from "./format";
import { callJSON } from "./llm";
import { log } from "./pipeline";
import { hybridSearch } from "./semantic";
import { getSetting, setSetting } from "./settings";

/**
 * «Quadro completo» di un argomento: il codice raccoglie il materiale (progetto, persona, obiettivo o tag riconosciuti,
 * più la ricerca per parole e significato), l'IA lo ordina in sezioni con le fonti. È una vista derivata:
 * non entra in memoria. Gli ultimi quadri restano in `settings.overviews` per riaprirli senza rifarli.
 */

/** taskId: per i prossimi passi che sono già un'attività aperta (niente doppioni). */
export type OverviewPoint = { text: string; refs: string[]; taskId?: string | null };
export type OverviewScope = { kind: "project" | "person" | "aim" | "tag" | "search"; id: string | null; label: string; href: string | null };
export type Overview = {
  topic: string; at: number; scope: OverviewScope;
  title: string; summary: string; goal: string | null; status: string;
  decisions: OverviewPoint[]; problems: OverviewPoint[]; contradictions: OverviewPoint[]; nextSteps: OverviewPoint[];
  people: { name: string; role: string; personId: string | null; refs: string[] }[];
  sources: { id: string; title: string; type: string | null; date: string }[];
  /** Quanti elementi e attività ha letto: se cambiano, il quadro è superato. */
  counts: { items: number; tasks: number };
};

const Point = z.object({ text: z.string(), refs: z.array(z.string()).describe("id degli elementi da cui viene (dal materiale); vuoto se viene da attività o obiettivi") });
const OverviewSchema = z.object({
  title: z.string().describe("Titolo del quadro, breve (es. «Progetto Alpha»)"),
  summary: z.string().describe("In breve: 2-4 frasi su cos'è e a che punto è. Se il materiale è poco, dillo qui"),
  goal: z.string().nullable().describe("Lo scopo o l'obiettivo, se emerge dal materiale; null altrimenti"),
  status: z.string().describe("Lo stato attuale in 1-2 frasi (avanzamento, cosa è fermo, cosa sta per succedere)"),
  decisions: z.array(Point).describe("Decisioni prese, dalla più recente; con il perché se c'è"),
  problems: z.array(Point).describe("Problemi e questioni aperte, rischi, cose in sospeso"),
  people: z.array(z.object({ name: z.string(), role: z.string().describe("Che ruolo ha in questo argomento"), refs: z.array(z.string()) })).describe("Le persone coinvolte"),
  contradictions: z.array(Point).describe("Informazioni in contrasto tra loro (indica la più recente); vuoto se non ce ne sono"),
  nextSteps: z.array(Point).describe("Prossime azioni concrete, 2-5: quelle già in attività aperte e quelle che mancano"),
});

type Material = { scope: OverviewScope; itemIds: string[]; taskRows: (typeof tasks.$inferSelect)[]; extra: Record<string, unknown> };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^#/, "").replace(/\s+/g, " ").trim();

/** Riconosce l'argomento (progetto, persona, obiettivo personale, tag) e raccoglie gli id collegati. */
async function gather(topic: string): Promise<Material> {
  const t = norm(topic);
  const [ps, pp, as, mem] = await Promise.all([
    db.select().from(projects),
    db.select().from(people),
    db.select().from(aims),
    db.select({ id: items.id, tags: items.tags, projectId: items.projectId, createdAt: items.createdAt }).from(items).where(eq(items.status, "memory")).orderBy(desc(items.createdAt)),
  ]);
  const match = <T,>(list: T[], name: (x: T) => string) =>
    list.find((x) => norm(name(x)) === t) ?? (t.length >= 4 ? list.find((x) => norm(name(x)).includes(t) || (norm(name(x)).length >= 4 && t.includes(norm(name(x))))) : undefined);

  let scope: OverviewScope = { kind: "search", id: null, label: topic, href: null };
  let ids: string[] = [];
  let taskRows: (typeof tasks.$inferSelect)[] = [];
  const extra: Record<string, unknown> = {};
  const project = match(ps, (p) => p.name);
  const person = project ? undefined : match(pp, (p) => p.name);
  const aim = project || person ? undefined : match(as, (a) => a.title);
  const tag = project || person || aim ? undefined : [...new Set(mem.flatMap((i) => i.tags))].find((x) => norm(x) === t);

  if (project) {
    scope = { kind: "project", id: project.id, label: project.name, href: `/progetti/${project.id}` };
    ids = mem.filter((i) => i.projectId === project.id).map((i) => i.id);
    taskRows = await db.select().from(tasks).where(eq(tasks.projectId, project.id));
    extra.progetto = { nome: project.name, stato: project.status, avanzamento: project.pct, descrizione: project.description, prossima_milestone: project.next };
    extra.obiettivi_del_progetto = (await db.select().from(goals).where(eq(goals.projectId, project.id))).map((g) => ({ obiettivo: g.title, raggiunto: g.done }));
  } else if (person) {
    scope = { kind: "person", id: person.id, label: person.name, href: `/persone/${person.id}` };
    ids = (await db.select({ itemId: itemPeople.itemId }).from(itemPeople).where(eq(itemPeople.personId, person.id))).map((r) => r.itemId);
    extra.persona = { nome: person.name, ruolo: person.role, organizzazione: person.org, note: person.note };
  } else if (aim) {
    scope = { kind: "aim", id: aim.id, label: aim.title, href: `/obiettivi/${aim.id}` };
    ids = (await db.select({ itemId: aimItems.itemId }).from(aimItems).where(eq(aimItems.aimId, aim.id))).map((r) => r.itemId);
    taskRows = await db.select().from(tasks).where(eq(tasks.aimId, aim.id));
    extra.obiettivo_personale = { titolo: aim.title, descrizione: aim.description, stato: aim.status, entro: aim.due };
  } else if (tag) {
    scope = { kind: "tag", id: null, label: "#" + tag, href: null };
    ids = mem.filter((i) => i.tags.includes(tag)).map((i) => i.id);
  }

  // Sempre anche la ricerca: prende ciò che ne parla senza essere collegato.
  const known = new Set(mem.map((i) => i.id));
  const found = await hybridSearch(scope.kind === "search" ? topic : `${scope.label} ${topic}`, 25).catch(() => [] as string[]);
  const order = new Map(mem.map((i, k) => [i.id, k]));
  const linked = ids.filter((id) => known.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
  const all = [...new Set([...linked, ...found.filter((id) => known.has(id))])].slice(0, 40);

  // Attività nate dagli elementi letti.
  if (all.length) {
    const fromItems = await db.select().from(tasks).where(inArray(tasks.sourceItemId, all));
    const seen = new Set(taskRows.map((x) => x.id));
    taskRows = [...taskRows, ...fromItems.filter((x) => !seen.has(x.id))];
  }
  return { scope, itemIds: all, taskRows: taskRows.slice(0, 40), extra };
}

async function saved(): Promise<Overview[]> {
  try { return JSON.parse((await getSetting("overviews")) ?? "[]"); } catch { return []; }
}

/** L'ultimo quadro salvato per questo argomento, se c'è. */
export async function cachedOverview(topic: string): Promise<Overview | null> {
  return (await saved()).find((o) => norm(o.topic) === norm(topic)) ?? null;
}

export async function recentOverviews(): Promise<{ topic: string; title: string; at: number; kind: OverviewScope["kind"] }[]> {
  return (await saved()).map((o) => ({ topic: o.topic, title: o.title, at: o.at, kind: o.scope.kind }));
}

export async function forgetOverview(topic: string) {
  await setSetting("overviews", JSON.stringify((await saved()).filter((o) => norm(o.topic) !== norm(topic))));
}

/** Elementi e attività che il quadro leggerebbe oggi: per dire se quello salvato è superato. */
export async function overviewCounts(topic: string) {
  const m = await gather(topic);
  return { items: m.itemIds.length, tasks: m.taskRows.length };
}

export async function buildOverview(topic: string): Promise<Overview> {
  const m = await gather(topic);
  const rows = m.itemIds.length
    ? await db.select({ id: items.id, title: items.title, type: items.type, summary: items.summary, content: items.content, tags: items.tags, createdAt: items.createdAt, source: items.source }).from(items).where(inArray(items.id, m.itemIds))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = m.itemIds.map((id) => byId.get(id)!).filter(Boolean);
  const [ip, conf] = m.itemIds.length ? await Promise.all([
    db.select({ itemId: itemPeople.itemId, personId: itemPeople.personId, name: people.name, role: people.role }).from(itemPeople).innerJoin(people, eq(people.id, itemPeople.personId)).where(inArray(itemPeople.itemId, m.itemIds)),
    db.select().from(links).where(and(eq(links.kind, "conflict"), or(inArray(links.fromId, m.itemIds), inArray(links.toId, m.itemIds)))),
  ]) : [[], []];
  const projectName = new Map((await db.select({ id: projects.id, name: projects.name }).from(projects)).map((p) => [p.id, p.name]));

  // I primi 12 con il testo (accorciato), gli altri solo con la sintesi: il contesto resta piccolo e veloce.
  const material = {
    oggi: isoDay(),
    argomento: topic,
    riconosciuto_come: m.scope.kind === "search" ? "ricerca libera" : `${m.scope.kind}: ${m.scope.label}`,
    ...m.extra,
    elementi: ordered.map((i, k) => ({
      id: i.id, tipo: i.type ?? "Nota", titolo: i.title, data: isoDay(i.createdAt), tag: i.tags, sintesi: i.summary ?? "",
      persone: ip.filter((x) => x.itemId === i.id).map((x) => x.name),
      ...(k < 12 ? { testo: i.content.slice(0, 1500) } : {}),
    })),
    attivita: m.taskRows.map((t) => ({ titolo: t.title, fatta: t.done, scadenza: t.due, progetto: t.projectId ? projectName.get(t.projectId) ?? null : null })),
    conflitti: conf.filter((l) => byId.has(l.fromId) || byId.has(l.toId)).map((l) => ({ a: l.fromId, b: l.toId, motivo: l.reason })),
    persone: [...new Map(ip.map((x) => [x.personId, { nome: x.name, ruolo: x.role }])).values()],
  };

  const out = await callJSON<z.infer<typeof OverviewSchema>>({
    tier: "smart", task: "quadro_completo", name: "quadro_completo", maxTokens: 3000,
    messages: [
      {
        role: "system",
        content: `Prepari il «quadro completo» di un argomento a partire dalla memoria di un Second Brain personale, in italiano.
Usa solo il materiale fornito, senza inventare; ogni punto indica in refs gli id degli elementi da cui viene. Sii concreto e sintetico: niente frasi generiche.
Se il materiale è scarso o non parla davvero dell'argomento, dillo nel summary e lascia vuote le sezioni senza dati. Le attività fatte contano come progressi, quelle aperte come prossime azioni: per queste usa esattamente il titolo dell'attività.`,
      },
      { role: "user", content: `<materiale>\n${JSON.stringify(material)}\n</materiale>` },
    ],
    jsonSchema: z.toJSONSchema(OverviewSchema),
    parse: (v) => OverviewSchema.safeParse(v) as { success: true; data: z.infer<typeof OverviewSchema> } | { success: false },
  });

  const valid = (refs: string[]) => [...new Set(refs)].filter((id) => byId.has(id));
  const points = (l: OverviewPoint[]) => l.map((p) => ({ text: p.text.trim(), refs: valid(p.refs) })).filter((p) => p.text);
  const personId = new Map(ip.map((x) => [norm(x.name), x.personId]));
  // I passi che sono già attività aperte non vanno ricreati.
  const openTasks = m.taskRows.filter((t) => !t.done);
  const sameTask = (text: string) => {
    const n = norm(text);
    return openTasks.find((t) => { const tn = norm(t.title); return tn === n || (Math.min(tn.length, n.length) >= 12 && (tn.includes(n) || n.includes(tn))); })?.id ?? null;
  };
  const cited = new Set([...out.decisions, ...out.problems, ...out.contradictions, ...out.nextSteps, ...out.people].flatMap((p) => valid(p.refs)));
  const ov: Overview = {
    topic, at: Date.now(), scope: m.scope,
    title: out.title.trim() || m.scope.label, summary: out.summary.trim(), goal: out.goal?.trim() || null, status: out.status.trim(),
    decisions: points(out.decisions), problems: points(out.problems), contradictions: points(out.contradictions),
    nextSteps: points(out.nextSteps).map((p) => ({ ...p, taskId: sameTask(p.text) })),
    people: out.people.map((p) => ({ name: p.name.trim(), role: p.role.trim(), personId: personId.get(norm(p.name)) ?? null, refs: valid(p.refs) })).filter((p) => p.name),
    // Prima le fonti citate, poi le altre lette.
    sources: [...ordered.filter((i) => cited.has(i.id)), ...ordered.filter((i) => !cited.has(i.id))].map((i) => ({ id: i.id, title: i.title, type: i.type, date: isoDay(i.createdAt) })),
    counts: { items: m.itemIds.length, tasks: m.taskRows.length },
  };
  await setSetting("overviews", JSON.stringify([ov, ...(await saved()).filter((o) => norm(o.topic) !== norm(topic))].slice(0, 12)));
  await log("Quadro completo", null, `${ov.title}: ${ov.counts.items} elementi, ${ov.counts.tasks} attività lette`);
  return ov;
}
