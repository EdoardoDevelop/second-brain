import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { facts, people } from "./db/schema";
import { isAboutUser, parseBirth } from "./fact-rules";
import { isoDay } from "./format";
import { getProfile } from "./settings";

const DAY = 86400000;

export type Birthday = {
  /** null = l'utente stesso. */
  personId: string | null;
  /** Nome della persona, «tu» per l'utente, oppure il testo del fatto se non si sa di chi è. */
  who: string;
  user: boolean;
  daysTo: number;
  /** Anni che compie, se è noto l'anno di nascita. */
  age: number | null;
};

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const mentions = (text: string, name: string) => {
  const n = plain(name).trim();
  return !!n && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(plain(text));
};

/**
 * Compleanni nei prossimi `within` giorni (0 = oggi), dai fatti confermati e dalle note delle persone.
 * Un fatto è dell'utente se ne parla in terza persona senza nominare nessun altro («È nato il 29 dicembre 1986»).
 */
export async function upcomingBirthdays(within = 7): Promise<Birthday[]> {
  const [fs, pp, profile] = await Promise.all([
    db.select({ text: facts.text }).from(facts).where(eq(facts.status, "confirmed")),
    db.select({ id: people.id, name: people.name, note: people.note }).from(people),
    getProfile(),
  ]);
  const today = Date.parse(isoDay() + "T00:00:00Z");
  const year = new Date(today).getUTCFullYear();
  const out = new Map<string, Birthday>();

  const add = (key: string, b: Omit<Birthday, "daysTo" | "age">, d: NonNullable<ReturnType<typeof parseBirth>>) => {
    let next = Date.UTC(year, d.month - 1, d.day);
    if (next < today) next = Date.UTC(year + 1, d.month - 1, d.day);
    const daysTo = Math.round((next - today) / DAY);
    if (daysTo > within || out.has(key)) return;
    out.set(key, { ...b, daysTo, age: d.year ? new Date(next).getUTCFullYear() - d.year : null });
  };

  for (const f of fs) {
    const d = parseBirth(f.text);
    if (!d) continue;
    // Il nome completo prima del solo nome: «Clelia» non deve prendere il compleanno di «Clelia Monti» se ce ne sono due.
    const person = pp.find((p) => mentions(f.text, p.name)) ?? pp.find((p) => mentions(f.text, p.name.split(/\s+/)[0]));
    if (person) add(person.id, { personId: person.id, who: person.name, user: false }, d);
    else if (isAboutUser(f.text, profile.name)) add("me", { personId: null, who: "tu", user: true }, d);
    else add("f:" + f.text, { personId: null, who: f.text, user: false }, d);
  }
  for (const p of pp) {
    for (const part of p.note.split(/[.;\n]+/)) {
      const d = parseBirth(part);
      if (d) { add(p.id, { personId: p.id, who: p.name, user: false }, d); break; }
    }
  }
  return [...out.values()].sort((a, b) => a.daysTo - b.daysTo);
}

/** «oggi», «domani», «tra 3 giorni». */
export const whenLabel = (days: number) => (days === 0 ? "oggi" : days === 1 ? "domani" : `tra ${days} giorni`);
