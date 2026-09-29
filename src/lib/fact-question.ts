import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { facts } from "./db/schema";
import { factAge, OLD_DAYS } from "./fact-age";
import { isoDay } from "./format";
import { getSetting, setSetting } from "./settings";

/**
 * «È ancora vero che…?»: una sola domanda al giorno su un fatto non confermato da almeno 90 giorni (il più vecchio),
 * mostrata nella Home sotto il riepilogo e in «Cosa so di te». Un fatto già chiesto non torna prima di 30 giorni.
 * Non cambia nulla da sola: risponde l'utente (Sì = riconferma, No = non più vero, Più tardi = niente).
 */

export type FactQuestion = { id: string; text: string; days: number };
type State = { day: string; id: string | null; answered: boolean };

const ASK_AGAIN_DAYS = 30;

export async function todayFactQuestion(): Promise<FactQuestion | null> {
  const today = isoDay();
  let state: State | null = null;
  try { state = JSON.parse((await getSetting("fact_question")) ?? "null"); } catch { /* nessuna */ }
  const rows = await db.select({ id: facts.id, text: facts.text, createdAt: facts.createdAt, lastConfirmedAt: facts.lastConfirmedAt }).from(facts).where(eq(facts.status, "confirmed"));
  const view = (f: (typeof rows)[number]): FactQuestion => ({ id: f.id, text: f.text, days: factAge(f.lastConfirmedAt?.getTime() ?? null, f.createdAt.getTime()).days });

  if (state?.day === today) {
    if (state.answered || !state.id) return null;
    const f = rows.find((r) => r.id === state!.id);
    // Se nel frattempo è stato riconfermato altrove, la domanda di oggi è chiusa.
    return f && view(f).days >= OLD_DAYS ? view(f) : null;
  }

  let asked: Record<string, number> = {};
  try { asked = JSON.parse((await getSetting("fact_asked")) ?? "{}"); } catch { /* nessuno */ }
  const cutoff = Date.now() - ASK_AGAIN_DAYS * 86400000;
  const pick = rows.map(view).filter((f) => f.days >= OLD_DAYS && (asked[f.id] ?? 0) < cutoff).sort((a, b) => b.days - a.days)[0] ?? null;
  await setSetting("fact_question", JSON.stringify({ day: today, id: pick?.id ?? null, answered: false } satisfies State));
  if (pick) {
    asked[pick.id] = Date.now();
    // Si tengono solo i fatti ancora esistenti.
    const ids = new Set(rows.map((r) => r.id));
    await setSetting("fact_asked", JSON.stringify(Object.fromEntries(Object.entries(asked).filter(([id]) => ids.has(id)))));
  }
  return pick;
}

/** La domanda di oggi ha avuto risposta (o è stata rimandata): per oggi non se ne fanno altre. */
export async function closeFactQuestion() {
  await setSetting("fact_question", JSON.stringify({ day: isoDay(), id: null, answered: true } satisfies State));
}
