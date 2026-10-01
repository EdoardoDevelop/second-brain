import "server-only";
import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { items, projects } from "./db/schema";
import { aiEnabled, newsTopics, rankNews } from "./ai";
import { log } from "./pipeline";
import { getSetting, setSetting } from "./settings";
import { isExcluded, type Article, type AutoTopic, type NewsConfig, type NewsFeed } from "./news";

/**
 * Notizie da Google News (feed RSS di ricerca, gratuiti, per uso personale).
 * Cache in `settings.news_feed` (2 ore) e argomenti automatici in `settings.news_topics` (24 ore):
 * così l'IA lavora poche volte al giorno anche con molte aperture della Home.
 */
const FEED_TTL = 2 * 3600_000;
const TOPICS_TTL = 24 * 3600_000;
const PER_TOPIC = 10;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m)
    .trim();
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];

async function fetchTopic(query: string, topic: string, auto: boolean, lang: "it" | "en", excluded: string[] = []): Promise<Article[]> {
  const loc = lang === "it" ? "hl=it&gl=IT&ceid=IT:it" : "hl=en-US&gl=US&ceid=US:en";
  // Gli esclusi anche nella ricerca (-"parola"), così i posti liberi vanno ad altre notizie; il filtro sui titoli resta comunque.
  const minus = excluded.slice(0, 10).map((e) => ` -"${e.replace(/"/g, "")}"`).join("");
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query}${minus} when:7d`)}&${loc}`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (Second Brain; lettore personale)" } });
    if (!res.ok) throw new Error(`Google News ${res.status}`);
    const xml = await res.text();
    const out: Article[] = [];
    for (const [, it] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const link = decode(tag(it, "link") ?? "");
      const source = decode(tag(it, "source") ?? "");
      let title = decode(tag(it, "title") ?? "");
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -source.length - 3);
      const published = Date.parse(tag(it, "pubDate") ?? "") || Date.now();
      if (!link || !title) continue;
      out.push({ id: crypto.createHash("sha1").update(link).digest("hex").slice(0, 12), title, source, url: link, published, topic, auto });
      if (out.length >= PER_TOPIC) break;
    }
    return out;
  } catch (e) {
    console.error("[notizie]", topic, e);
    return [];
  }
}

/** Riassunto compatto della memoria per l'IA: tag ricorrenti, progetti attivi, elementi recenti. */
async function memorySnapshot() {
  const [recent, projs] = await Promise.all([
    db.select({ title: items.title, type: items.type, summary: items.summary, tags: items.tags }).from(items).where(eq(items.status, "memory")).orderBy(desc(items.createdAt)).limit(60),
    db.select({ name: projects.name, description: projects.description, status: projects.status }).from(projects),
  ]);
  const tagCount = new Map<string, number>();
  for (const i of recent) for (const t of i.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  return {
    tag_ricorrenti: [...tagCount].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => t),
    progetti: projs.filter((p) => p.status !== "Chiuso").map((p) => ({ nome: p.name, descrizione: p.description.slice(0, 200) })),
    elementi_recenti: recent.slice(0, 40).map((i) => ({ titolo: i.title, tipo: i.type, sintesi: (i.summary ?? "").slice(0, 160) })),
  };
}

/** Argomenti automatici (dall'IA), rigenerati una volta al giorno o su richiesta. */
async function getAutoTopics(cfg: NewsConfig, force: boolean, memory: unknown): Promise<AutoTopic[]> {
  const saved = JSON.parse((await getSetting("news_topics")) ?? "null") as { at: number; topics: AutoTopic[] } | null;
  if (saved && !force && Date.now() - saved.at < TOPICS_TTL) return saved.topics;
  const topics = await newsTopics(memory, cfg.topics, cfg.excluded);
  await setSetting("news_topics", JSON.stringify({ at: Date.now(), topics }));
  await log("Notizie: argomenti dalla memoria", null, topics.map((t) => t.label).join(", ") || "nessuno");
  return topics;
}

const cfgKey = (c: NewsConfig) => JSON.stringify([c.topics, c.auto, c.intl, c.count, c.excluded]);

/** Le più recenti di ogni argomento, a turno: con le sole più recenti un argomento molto attivo occupava tutti i posti. */
function roundRobin(list: Article[], max: number): Article[] {
  const by = new Map<string, Article[]>();
  for (const a of list) by.set(a.topic, [...(by.get(a.topic) ?? []), a]);
  const queues = [...by.values()];
  const out: Article[] = [];
  for (let i = 0; out.length < max && queues.some((q) => q.length > i); i++) for (const q of queues) if (q[i] && out.length < max) out.push(q[i]);
  return out;
}

/** Valutazioni dell'IA per notizia (`settings.news_ranked`), valide 24 ore e per la stessa configurazione. */
type Ranked = { key: string; scores: Record<string, { score: number; reason: string; at: number }> };
const RANK_TTL = 24 * 3600_000;
let inflight: { key: string; p: Promise<NewsFeed> } | null = null;

/** Notizie della Home: dalla cache se recenti, altrimenti le raccoglie (e le fa scegliere all'IA). */
export async function getNewsFeed(cfg: NewsConfig, opts: { force?: boolean; newTopics?: boolean } = {}): Promise<NewsFeed> {
  if (!opts.force && !opts.newTopics) {
    const saved = JSON.parse((await getSetting("news_feed")) ?? "null") as (NewsFeed & { key: string }) | null;
    if (saved && saved.key === cfgKey(cfg) && Date.now() - saved.at < FEED_TTL) return saved;
  }
  // Più aperture contemporanee della Home: una sola raccolta.
  const key = cfgKey(cfg) + (opts.newTopics ? "+" : "");
  if (inflight?.key !== key) {
    const p = build(cfg, !!opts.newTopics).finally(() => { if (inflight?.p === p) inflight = null; });
    inflight = { key, p };
  }
  return inflight.p;
}

async function build(cfg: NewsConfig, newTopics: boolean): Promise<NewsFeed> {
  const useAi = cfg.auto && (await aiEnabled());
  let aiError: string | undefined;
  const memory = useAi ? await memorySnapshot() : null;
  let autoTopics: AutoTopic[] = [];
  if (useAi) {
    // Gli argomenti salvati possono essere di prima di un'esclusione nuova: si filtrano comunque.
    try { autoTopics = (await getAutoTopics(cfg, newTopics, memory)).filter((a) => !isExcluded(`${a.label} ${a.query}`, cfg.excluded)); }
    catch (e) { aiError = (e as Error).message; await log("Notizie: argomenti dalla memoria", null, `Errore: ${aiError}`); }
  }

  const langs: ("it" | "en")[] = cfg.intl ? ["it", "en"] : ["it"];
  const jobs = [
    ...cfg.topics.map((t) => ({ query: t, topic: t, auto: false })),
    ...autoTopics.filter((a) => !cfg.topics.some((t) => t.toLowerCase() === a.label.toLowerCase())).map((a) => ({ query: a.query, topic: a.label, auto: true })),
  ];
  const lists = await Promise.all(jobs.flatMap((j) => langs.map((l) => fetchTopic(j.query, j.topic, j.auto, l, cfg.excluded))));

  // Doppioni: stesso link o stesso titolo (la stessa notizia ripresa da più argomenti).
  const seen = new Set<string>();
  const articles = lists.flat().sort((a, b) => b.published - a.published).filter((a) => !isExcluded(a.title, cfg.excluded)).filter((a) => {
    const k = a.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 70);
    if (seen.has(a.id) || seen.has(k)) return false;
    seen.add(a.id); seen.add(k);
    return true;
  });

  let forYou: string[] = [];
  if (useAi && articles.length) {
    try {
      const candidates = roundRobin(articles, 60);
      // Valutazioni già fatte (stessa configurazione, ultime 24 ore): all'IA vanno solo i titoli nuovi,
      // e se non ce ne sono nessuna chiamata. Prima ogni giro (circa ogni 2 ore) rimandava tutti i 60 titoli.
      const rkey = cfgKey(cfg);
      const saved = JSON.parse((await getSetting("news_ranked")) ?? "null") as Ranked | null;
      const ranked: Ranked["scores"] = saved?.key === rkey ? Object.fromEntries(Object.entries(saved.scores).filter(([, s]) => Date.now() - s.at < RANK_TTL)) : {};
      const fresh = candidates.filter((a) => !ranked[a.id]);
      if (fresh.length) {
        // Il doppio dei posti: con il limite per argomento servono riserve.
        const picks = await rankNews(memory, fresh.map((a) => ({ id: a.id, title: a.title, source: a.source, topic: a.topic })), cfg.count * 2, cfg.excluded);
        const at = Date.now();
        // Le non scelte restano a 0: valutate, non si rimandano.
        for (const a of fresh) ranked[a.id] = { score: 0, reason: "", at };
        for (const p of picks) ranked[p.id] = { score: p.score, reason: p.reason, at };
        await setSetting("news_ranked", JSON.stringify({ key: rkey, scores: ranked } satisfies Ranked));
      }
      // Varietà: al massimo un terzo della scheda sullo stesso argomento (prima uscivano solo notizie di domotica).
      const perTopic = Math.max(2, Math.ceil(cfg.count / 3));
      const used = new Map<string, number>();
      const picks = candidates.filter((a) => (ranked[a.id]?.score ?? 0) > 0)
        .sort((a, b) => ranked[b.id].score - ranked[a.id].score || b.published - a.published)
        .filter((a) => { const n = used.get(a.topic) ?? 0; used.set(a.topic, n + 1); return n < perTopic; })
        .slice(0, cfg.count);
      for (const a of picks) {
        a.reason = ranked[a.id].reason;
        a.score = ranked[a.id].score;
      }
      forYou = picks.map((a) => a.id);
      await log("Notizie: selezione per te", null, `${picks.length} scelte su ${candidates.length}${fresh.length < candidates.length ? ` (${fresh.length} nuove valutate dall'IA)` : ""}`);
    } catch (e) {
      aiError = (e as Error).message;
      await log("Notizie: selezione per te", null, `Errore: ${aiError}`);
    }
  }

  const feed: NewsFeed = { at: Date.now(), articles, forYou, autoTopics, aiError };
  await setSetting("news_feed", JSON.stringify({ ...feed, key: cfgKey(cfg) }));
  return feed;
}
