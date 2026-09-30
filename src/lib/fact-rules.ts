/**
 * Regole sui testi dei fatti su di te (senza IA, condivise e testabili):
 * - `factKey`: impronta del significato, per riconoscere lo stesso fatto detto con parole o formato diversi
 *   («Sono nato il 29/12/1986» = «È nato il 29 dicembre 1986»);
 * - `parseBirth`: data di nascita o di compleanno contenuta in un fatto o in una nota.
 */

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

/** Parole che non cambiano il senso di un fatto: articoli, preposizioni, possessivi, persona del verbo essere/avere. */
const STOP = new Set(("il lo la i gli le l un una uno di del dello della dei degli delle d da dal dallo dalla dai dagli dalle " +
  "in nel nello nella nei negli nelle a al allo alla ai agli alle ad e ed o che per con su sul sulla tra fra " +
  "mio mia miei mie suo sua suoi sue tuo tua sono sei ha ho hai io lui lei utente anno").split(" "));

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Impronta di un fatto: parole che contano, date in numeri, ordine e forma del verbo ignorati. */
export function factKey(text: string): string {
  let t = plain(text).replace(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g, " $1 $2 $3 ");
  MONTHS.forEach((m, i) => { t = t.replace(new RegExp(`\\b${m}\\b`, "g"), ` ${i + 1} `); });
  const words = t.split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w)).map((w) => (/^\d+$/.test(w) ? String(Number(w)) : w));
  return [...new Set(words)].sort().join(" ");
}

/**
 * Filtro dei fatti proposti: scarta quelli che dicono la stessa cosa di un fatto già noto (anche con altre parole)
 * e i doppioni nella stessa proposta. Il predicato ricorda quelli già accettati.
 */
export function freshFacts(known: { text: string }[]): (text: string) => boolean {
  const seen = new Set(known.map((k) => factKey(k.text)));
  return (text) => {
    const k = factKey(text);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  };
}

export type BirthDate = { day: number; month: number; year: number | null };

/** Data di nascita o di compleanno in un testo («È nato il 29 dicembre 1986», «compie gli anni il 3/5»). */
export function parseBirth(text: string): BirthDate | null {
  const t = plain(text);
  if (!/\b(nat[oaie]|nascita|compleanno|compie gli anni)\b/.test(t)) return null;
  let day = 0, month = 0, year: number | null = null;
  const num = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?\b/);
  const named = t.match(new RegExp(`\\b(\\d{1,2})(?:°|º)?\\s+(${MONTHS.join("|")})(?:\\s+(?:del\\s+|nel\\s+)?(\\d{4}))?`));
  if (named) { day = Number(named[1]); month = MONTHS.indexOf(named[2]) + 1; year = named[3] ? Number(named[3]) : null; }
  else if (num) { day = Number(num[1]); month = Number(num[2]); year = num[3] ? Number(num[3]) : null; }
  else return null;
  year ??= Number(t.match(/\b(19|20)\d{2}\b/)?.[0]) || null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month, year };
}

/**
 * L'utente ha nominato davvero questa persona nel testo (nome o cognome, parola intera)? Serve a non attribuire
 * a una persona nota qualcuno di cui l'utente non ha detto il nome («il nuovo collega» non è Diego Bernardi).
 */
export function namesPerson(text: string, fullName: string): boolean {
  const t = " " + plain(text).replace(/[^\p{L}\p{N}]+/gu, " ") + " ";
  return plain(fullName).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3).some((w) => t.includes(` ${w} `));
}

/** Un fatto parla della nascita dell'utente stesso (non di un'altra persona): «È nato…», «Il suo compleanno…». */
export function isAboutUser(text: string, userName = ""): boolean {
  let t = plain(text);
  for (const w of plain(userName).split(/\s+/).filter((x) => x.length > 1)) t = t.replace(new RegExp(`\\b${w}\\b`, "g"), " ");
  t = t.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  return /^((l )?utente )?(e |sono )?nat[oa]\b/.test(t) || /\b(mio|suo) compleanno\b/.test(t) || /^(la )?(mia|sua) data di nascita\b/.test(t) || /^compie gli anni\b/.test(t);
}
