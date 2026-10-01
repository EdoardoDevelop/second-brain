// Formattazione date in italiano, usata sia dal server sia dal client.
const TZ = process.env.NEXT_PUBLIC_TZ || "Europe/Rome";

const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const DAYS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

/** YYYY-MM-DD nel fuso dell'utente. */
export function isoDay(d: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * I prossimi giorni con il nome («oggi giovedì 2026-10-01, domani venerdì 2026-10-02, sabato 2026-10-03…»), per l'IA:
 * calcolate a mente, le date relative sbagliavano (il 1/10, giovedì, «venerdì» diventava il 9/10).
 */
export function nextDays(n = 14, from: Date = new Date()): string {
  const [y, m, d] = isoDay(from).split("-").map(Number);
  const wd = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", weekday: "long" });
  return Array.from({ length: n }, (_, i) => {
    const day = new Date(Date.UTC(y!, m! - 1, d! + i, 12));
    return `${i === 0 ? "oggi " : i === 1 ? "domani " : ""}${wd.format(day)} ${day.toISOString().slice(0, 10)}`;
  }).join(", ");
}

/** Ora attuale HH:MM nel fuso dell'utente (per «alle 6»: oggi se non è ancora passata, altrimenti domani). */
export function nowTime(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

const DAY_SHIFT: Record<string, string> = { dopodomani: "domani", domani: "oggi", oggi: "ieri", stasera: "ieri sera", stamattina: "ieri mattina", ieri: "l'altro ieri" };

/**
 * Un testo scritto ieri riletto oggi: «domani» diventa «oggi», «oggi» diventa «ieri»… Messo solo nel prompt, il modello
 * annunciava ancora come futuro ciò che il diario di ieri sera diceva per «domani».
 */
export function shiftToToday(text: string): string {
  return text.replace(/\b(dopodomani|domani|oggi|stasera|stamattina|ieri)\b/gi, (w) => {
    const r = DAY_SHIFT[w.toLowerCase()]!;
    return w[0] === w[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r;
  });
}

function parts(d: Date) {
  const [y, m, day] = isoDay(d).split("-").map(Number);
  return { y, m, day };
}

/** Istante (ms) di un giorno YYYY-MM-DD e di un orario HH:MM nel fuso dell'app, ora legale compresa. */
export function zonedTime(day: string, time: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(guess)).map((p) => [p.type, Number(p.value)]),
  );
  const shown = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
  return guess - (shown - guess);
}

export const validTime = (t: string | null | undefined) => (t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null);

/** Scelte di anticipo del promemoria, in minuti. */
export const REMIND_OPTIONS: [number, string][] = [[0, "All'orario"], [10, "10 minuti prima"], [30, "30 minuti prima"], [60, "1 ora prima"], [1440, "1 giorno prima"]];

/** Campi del promemoria da salvare su un'attività: senza data o orario non c'è promemoria. */
export function reminderFields(due: string | null, time: string | null, remind: number | null) {
  const t = validTime(time);
  const r = due && t && remind != null && remind >= 0 ? Math.round(remind) : null;
  return { time: due ? t : null, remind: r, remindAt: r != null ? zonedTime(due!, t!) - r * 60000 : null, reminded: false };
}

function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
}

/** "12 set" */
export function shortDate(d: Date) {
  const { m, day } = parts(d);
  return `${day} ${MONTHS[m - 1]}`;
}

/** "12 set 2026, 11:42" */
export function longDate(d: Date) {
  const { y, m, day } = parts(d);
  return `${day} ${MONTHS[m - 1]} ${y}, ${clock(d)}`;
}

export function clock(d: Date) {
  return new Intl.DateTimeFormat("it-IT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
}

/** "18:12" oggi, "Ieri", altrimenti "12 set". */
export function relTime(d: Date) {
  const diff = dayDiff(isoDay(), isoDay(d));
  if (diff === 0) return clock(d);
  if (diff === 1) return "Ieri";
  return shortDate(d);
}

export type DueGroup = "overdue" | "today" | "week" | "later" | "none";

export function dueInfo(due: string | null): { group: DueGroup; label: string } {
  if (!due) return { group: "none", label: "" };
  const diff = dayDiff(due, isoDay());
  const d = new Date(due + "T12:00:00Z");
  const label =
    diff === 0 ? "Oggi" : diff === -1 ? "Ieri" : diff === 1 ? "Domani" : diff > 1 && diff < 7
      ? `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
      : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const group: DueGroup = diff < 0 ? "overdue" : diff === 0 ? "today" : diff < 7 ? "week" : "later";
  return { group, label };
}

/** Come dueInfo, con l'anno se la data non è nell'anno corrente (per le scadenze lontane, es. degli obiettivi). */
export function dueLabel(due: string): string {
  const { label } = dueInfo(due);
  return due.slice(0, 4) !== isoDay().slice(0, 4) && /^\d+ /.test(label) ? `${label} ${due.slice(0, 4)}` : label;
}

export function greeting(d: Date = new Date()) {
  const h = Number(new Intl.DateTimeFormat("it-IT", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d));
  return h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
}

/** "Giovedì 24 settembre · 19:40" */
export function headerDate(d: Date = new Date()) {
  const s = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1) + " · " + clock(d);
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}
