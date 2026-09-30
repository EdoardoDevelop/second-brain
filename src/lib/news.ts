/** Notizie della Home (condiviso server/client): configurazione in `settings.news` e forma degli articoli. */

export type NewsConfig = {
  /** Argomenti scelti a mano (parole di ricerca). */
  topics: string[];
  /** Argomenti ricavati dall'IA dalla memoria, e notizie ordinate per interesse. */
  auto: boolean;
  /** Anche fonti internazionali (in inglese). */
  intl: boolean;
  /** Notizie mostrate per scheda. */
  count: 5 | 8 | 12;
  /** Argomenti da escludere (parole o frasi): notizie scartate, e l'IA non li propone. */
  excluded: string[];
};

export const DEFAULT_NEWS: NewsConfig = { topics: [], auto: true, intl: false, count: 8, excluded: [] };

/** Minuscolo, senza accenti né punteggiatura, con spazi ai lati: «Càlcio,» e «calcio» sono la stessa parola. */
const norm = (s: string) => " " + s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " ";

/**
 * Il testo parla di un argomento escluso? Parole intere, più il cambio dell'ultima vocale
 * (singolare/plurale: «elezione» esclude anche «elezioni»; «calcio» non esclude «calciatore»).
 */
export function isExcluded(text: string, excluded: string[]): boolean {
  if (!excluded.length) return false;
  const t = norm(text);
  return excluded.some((e) => {
    const x = norm(e).trim();
    if (!x) return false;
    if (t.includes(` ${x} `)) return true;
    if (x.length < 4 || !/[aeiou]$/.test(x)) return false;
    const stem = x.slice(0, -1);
    return ["a", "e", "i", "o"].some((v) => t.includes(` ${stem}${v} `));
  });
}

const cleanList = (v: unknown, max: number) => {
  const seen = new Set<string>();
  return (Array.isArray(v) ? v : [])
    .map((t) => String(t).replace(/\s+/g, " ").trim().slice(0, 60))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, max);
};

export function parseNewsConfig(raw: string | null | undefined): NewsConfig {
  let v: Partial<NewsConfig> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { /* predefinita */ }
  return {
    topics: cleanList(v.topics, 12), auto: v.auto !== false, intl: v.intl === true, count: v.count === 5 || v.count === 12 ? v.count : 8,
    excluded: cleanList(v.excluded, 20),
  };
}

/** Argomento proposto dall'IA: `query` per la ricerca, `why` per spiegare il legame con la memoria. */
export type AutoTopic = { label: string; query: string; why: string };

export type Article = {
  id: string;
  title: string;
  source: string;
  url: string;
  published: number;
  /** Argomento (manuale o automatico) che l'ha trovata. */
  topic: string;
  auto: boolean;
  /** Solo per le notizie scelte dall'IA: perché può interessarti. */
  reason?: string;
  score?: number;
};

export type NewsFeed = {
  at: number;
  articles: Article[];
  /** Id delle notizie "Per te", in ordine di interesse (vuoto senza IA). */
  forYou: string[];
  autoTopics: AutoTopic[];
  aiError?: string;
};

/** Notizia catturata: id dell'elemento creato in Inbox. */
export type CapturedMap = Record<string, string>;
