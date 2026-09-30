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
      const candidates = articles.slice(0, 60);
      const picks = await rankNews(memory, candidates.map((a) => ({ id: a.id, title: a.title, source: a.source, topic: a.topic })), cfg.count, cfg.excluded);
      for (const p of picks) {
        const a = articles.find((x) => x.id === p.id)!;
        a.reason = p.reason;
        a.score = p.score;
      }
      forYou = picks.map((p) => p.id);
      await log("Notizie: selezione per te", null, `${picks.length} scelte su ${candidates.length}`);
    } catch (e) {
      aiError = (e as Error).message;
      await log("Notizie: selezione per te", null, `Errore: ${aiError}`);
    }
  }

  const feed: NewsFeed = { at: Date.now(), articles, forYou, autoTopics, aiError };
  await setSetting("news_feed", JSON.stringify({ ...feed, key: cfgKey(cfg) }));
  return feed;
}
