/**
 * Invecchiamento dei fatti su di te, dalla data dell'ultima conferma: fresco, vecchio (da ricontrollare quando capita),
 * forse superato (da riconfermare). Nessuna cancellazione automatica: serve a chiedere e a pesare i fatti.
 * Condiviso tra browser (Cosa so di te) e server (contesto dell'IA, domanda del giorno, cura notturna).
 */
export const OLD_DAYS = 90;
export const STALE_DAYS = 180;
const DAY = 86400000;

export type FactAge = "fresh" | "old" | "stale";

export function factAge(lastConfirmedAt: number | null, createdAt: number, now = Date.now()): { age: FactAge; days: number } {
  const days = Math.max(0, Math.floor((now - (lastConfirmedAt ?? createdAt)) / DAY));
  return { age: days >= STALE_DAYS ? "stale" : days >= OLD_DAYS ? "old" : "fresh", days };
}

/** «confermato oggi», «confermato 12 giorni fa», «confermato 7 mesi fa», «confermato più di un anno fa». */
export function confirmedAgo(days: number) {
  if (days < 1) return "confermato oggi";
  if (days < 45) return `confermato ${days === 1 ? "ieri" : `${days} giorni fa`}`;
  const months = Math.round(days / 30);
  return months < 12 ? `confermato ${months} mesi fa` : months < 24 ? "confermato più di un anno fa" : `confermato ${Math.floor(months / 12)} anni fa`;
}

export const AGE_LABEL: Record<FactAge, string> = { fresh: "Fresco", old: "Vecchio", stale: "Forse superato" };
