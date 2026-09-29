import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { aims, items, projects, tasks } from "./db/schema";
import { isoDay } from "./format";

/**
 * Anticipazione, tutta calcolata dal codice (l'IA sceglie poi cosa proporre):
 * - abitudini: attività ed elementi con titoli simili che si ripetono con un ritmo (ogni lunedì, ogni due settimane,
 *   ogni mese intorno al giorno N, ogni N giorni) e la prossima volta attesa;
 * - scadenze vicine: progetti e obiettivi con più attività in scadenza nei prossimi giorni, da pianificare.
 */

const DAY = 86400000;
const WINDOW_DAYS = 120;
const WEEKDAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const MONTHS = "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre gen feb mar apr mag giu lug ago set ott nov dic".split(" ");
const STOP = new Set("il lo la i gli le un uno una di da in con su per tra fra a e o ma che del della dei delle dello degli al alla ai alle allo agli dal dalla nel nella nei nelle sul sulla sui sulle mio mia suo sua nostro nuovo nuova settimana settimanale mese mensile oggi domani ieri".split(" "));

type Occ = { date: string; title: string; source: "task" | "item"; id: string; words: Set<string> };
export type Cadence = { kind: "weekly" | "biweekly" | "monthly" | "every"; weekday?: number; day?: number; every?: number };
export type Habit = {
  key: string; label: string; cadence: Cadence; cadenceLabel: string;
  dates: string[]; last: string; next: string; daysToNext: number;
  /** Ultimi elementi o attività della serie (per ripartire da lì). */
  recent: { id: string; title: string; source: "task" | "item"; date: string }[];
};

/** Parole significative di un titolo: senza accenti, date, numeri, mesi, giorni e parole vuote. */
function words(title: string): Set<string> {
  const t = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b\d{1,4}([/.-]\d{1,2}){1,2}\b/g, " ").replace(/\d+/g, " ").replace(/[^a-z\s]/g, " ");
  const days = new Set(WEEKDAYS.map((d) => d.normalize("NFD").replace(/[̀-ͯ]/g, "")));
  return new Set(t.split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w) && !MONTHS.includes(w) && !days.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
}

/** Il nome dell'abitudine senza la data della singola volta: «Riunione di reparto del 23/9» → «Riunione di reparto». */
function cleanLabel(title: string) {
  const t = title.replace(/\s*(?:[-–—,(]\s*)?(?:del(?:l')?\s+|di\s+|il\s+)?\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\)?/g, "").replace(/\s{2,}/g, " ").replace(/[\s,;:–—-]+$/, "").trim();
  return t || title;
}

/** Due titoli parlano della stessa cosa ricorrente (es. «Report settimanale 12/9» e «Report settimanale»). */
export const sameSeries = (a: string, b: string) => jaccard(words(a), words(b)) >= 0.6;

const toMs = (d: string) => Date.parse(d + "T12:00:00Z");
const weekday = (d: string) => new Date(toMs(d)).getUTCDay();
const addDays = (d: string, n: number) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
const median = (l: number[]) => { const s = [...l].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Ritmo di una serie di date (distinte, ordinate), se c'è. */
function cadenceOf(dates: string[]): Cadence | null {
  const gaps = dates.slice(1).map((d, i) => Math.round((toMs(d) - toMs(dates[i])) / DAY));
  if (gaps.length < 2 || gaps.some((g) => g <= 0)) return null;
  const m = median(gaps);
  const wd = dates.map(weekday);
  const sameWd = wd.filter((w) => w === wd[wd.length - 1]).length / wd.length;
  if (m >= 6 && m <= 8 && sameWd >= 0.75) return { kind: "weekly", weekday: wd[wd.length - 1] };
  if (m >= 13 && m <= 15 && sameWd >= 0.75) return { kind: "biweekly", weekday: wd[wd.length - 1] };
  const dom = dates.map((d) => Number(d.slice(8, 10)));
  if (m >= 27 && m <= 32 && Math.max(...dom) - Math.min(...dom) <= 4) return { kind: "monthly", day: dom[dom.length - 1] };
  // Ritmo regolare qualsiasi: scarto medio piccolo rispetto alla media.
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const dev = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  if (mean >= 2 && mean <= 45 && dev / mean <= 0.25) return { kind: "every", every: Math.round(mean) };
  return null;
}

function nextDate(c: Cadence, last: string, today: string): string {
  const step = c.kind === "weekly" ? 7 : c.kind === "biweekly" ? 14 : c.kind === "every" ? c.every! : 0;
  let next: string;
  if (c.kind === "monthly") {
    const [y, mo] = last.split("-").map(Number);
    const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1;
    const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    next = `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(c.day!, lastDay)).padStart(2, "0")}`;
    while (next < today) next = nextDate(c, next, next);
    return next;
  }
  next = addDays(last, step);
  while (next < today) next = addDays(next, step);
  return next;
}

export function cadenceLabel(c: Cadence) {
  switch (c.kind) {
    case "weekly": return `ogni ${WEEKDAYS[c.weekday!]}`;
    case "biweekly": return `un ${WEEKDAYS[c.weekday!]} sì e uno no`;
    case "monthly": return `ogni mese intorno al ${c.day}`;
    default: return `ogni ${c.every} giorni circa`;
  }
}

/** Le abitudini ancora vive (l'ultima volta non è troppo lontana rispetto al ritmo). */
export async function detectHabits(): Promise<Habit[]> {
  const today = isoDay();
  const since = Date.now() - WINDOW_DAYS * DAY;
  const [ts, its] = await Promise.all([
    db.select({ id: tasks.id, title: tasks.title, due: tasks.due, createdAt: tasks.createdAt }).from(tasks),
    db.select({ id: items.id, title: items.title, createdAt: items.createdAt, status: items.status }).from(items).where(inArray(items.status, ["memory", "archived"])),
  ]);
  // La data di un'attività è la scadenza se c'è (è quando si fa), altrimenti la creazione.
  const occ: Occ[] = [
    ...ts.map((t) => ({ date: t.due ?? isoDay(t.createdAt), title: t.title, source: "task" as const, id: t.id })),
    ...its.map((i) => ({ date: isoDay(i.createdAt), title: i.title, source: "item" as const, id: i.id })),
  ].filter((o) => toMs(o.date) >= since && o.date <= addDays(today, 14)).map((o) => ({ ...o, words: words(o.title) })).filter((o) => o.words.size > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Raggruppamento: ogni occorrenza va nel primo gruppo con parole abbastanza simili (confronto con le ultime).
  const groups: Occ[][] = [];
  for (const o of occ) {
    const g = groups.find((l) => l.slice(-3).some((x) => jaccard(x.words, o.words) >= 0.6));
    if (g) g.push(o); else groups.push([o]);
  }

  const out: Habit[] = [];
  for (const g of groups) {
    // Una data per giorno (attività ed elemento dello stesso giorno sono la stessa volta).
    const dates = [...new Set(g.map((o) => o.date))].filter((d) => d <= today).sort();
    if (dates.length < 3) continue;
    const c = cadenceOf(dates);
    if (!c) continue;
    const last = dates[dates.length - 1];
    const period = c.kind === "weekly" ? 7 : c.kind === "biweekly" ? 14 : c.kind === "monthly" ? 30 : c.every!;
    // Serie interrotta: saltate più di due volte.
    if ((toMs(today) - toMs(last)) / DAY > period * 2 + 3) continue;
    // Se è successo oggi, la prossima volta è dopo oggi.
    const next = nextDate(c, last, last >= today ? addDays(today, 1) : today);
    const latest = [...g].sort((a, b) => b.date.localeCompare(a.date));
    const label = cleanLabel(latest.find((o) => o.source === "task")?.title ?? latest[0].title);
    out.push({
      key: [...latest[0].words].sort().join("-").slice(0, 80) + ":" + c.kind,
      label, cadence: c, cadenceLabel: cadenceLabel(c), dates, last, next,
      daysToNext: Math.round((toMs(next) - toMs(today)) / DAY),
      recent: latest.filter((o) => o.date <= today).slice(0, 3).map((o) => ({ id: o.id, title: o.title, source: o.source, date: o.date })),
    });
  }
  return out.sort((a, b) => a.daysToNext - b.daysToNext);
}

export type DeadlineGroup = {
  key: string; kind: "project" | "aim" | "none"; id: string | null; name: string;
  /** Fino a quando guarda (la scadenza più lontana del gruppo, o dell'obiettivo). */
  until: string; aimDue: string | null;
  dueSoon: { id: string; title: string; due: string; prio: number }[];
  overdue: { id: string; title: string; due: string }[];
  undated: { id: string; title: string }[];
};

/** Gruppi di attività da pianificare: ≥3 in scadenza entro 7 giorni nello stesso progetto (o senza progetto), o un obiettivo che scade entro 14 giorni con ≥2 attività aperte. */
export async function upcomingDeadlines(): Promise<DeadlineGroup[]> {
  const today = isoDay();
  const in7 = addDays(today, 7);
  const [open, ps, as] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.done, false)),
    db.select({ id: projects.id, name: projects.name }).from(projects),
    db.select().from(aims).where(eq(aims.status, "active")),
  ]);
  const out: DeadlineGroup[] = [];
  const build = (kind: DeadlineGroup["kind"], id: string | null, name: string, list: typeof open, aimDue: string | null = null): DeadlineGroup => {
    const soon = list.filter((t) => t.due && t.due >= today && t.due <= (aimDue && aimDue > in7 ? aimDue : in7)).sort((a, b) => a.due!.localeCompare(b.due!));
    return {
      key: `${kind}:${id ?? "-"}`, kind, id, name, aimDue,
      until: aimDue ?? soon[soon.length - 1]?.due ?? in7,
      dueSoon: soon.map((t) => ({ id: t.id, title: t.title, due: t.due!, prio: t.prio })),
      overdue: list.filter((t) => t.due && t.due < today).map((t) => ({ id: t.id, title: t.title, due: t.due! })).slice(0, 5),
      undated: list.filter((t) => !t.due).map((t) => ({ id: t.id, title: t.title })).slice(0, 6),
    };
  };
  const byProject = new Map<string | null, typeof open>();
  for (const t of open) if (!t.aimId || t.projectId) byProject.set(t.projectId, [...(byProject.get(t.projectId) ?? []), t]);
  for (const [pid, list] of byProject) {
    const g = build(pid ? "project" : "none", pid, pid ? ps.find((p) => p.id === pid)?.name ?? "Progetto" : "Senza progetto", list);
    if (g.dueSoon.length >= 3) out.push(g);
  }
  for (const a of as) {
    if (!a.due || a.due < today || a.due > addDays(today, 14)) continue;
    const g = build("aim", a.id, a.title, open.filter((t) => t.aimId === a.id), a.due);
    if (g.dueSoon.length + g.undated.length + g.overdue.length >= 2) out.push(g);
  }
  return out.slice(0, 4);
}
