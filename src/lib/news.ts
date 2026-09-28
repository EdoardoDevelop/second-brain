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
};

export const DEFAULT_NEWS: NewsConfig = { topics: [], auto: true, intl: false, count: 8 };

export function parseNewsConfig(raw: string | null | undefined): NewsConfig {
  let v: Partial<NewsConfig> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { /* predefinita */ }
  const seen = new Set<string>();
  const topics = (Array.isArray(v.topics) ? v.topics : [])
    .map((t) => String(t).replace(/\s+/g, " ").trim().slice(0, 60))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 12);
  return { topics, auto: v.auto !== false, intl: v.intl === true, count: v.count === 5 || v.count === 12 ? v.count : 8 };
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
