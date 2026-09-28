import "server-only";
import crypto from "node:crypto";
import { eq, notInArray } from "drizzle-orm";
import { db } from "./db";
import { aiUsage, embeddings, items } from "./db/schema";
import { OPENROUTER_URL } from "./llm";
import { searchMemory } from "./queries";
import { getAiConfig, setSetting } from "./settings";

/**
 * Ricerca per significato: ogni elemento in memoria ha un'impronta (embedding) calcolata via OpenRouter
 * con la stessa privacy delle altre chiamate. I vettori stanno in `embeddings` e, per la ricerca,
 * in memoria nel processo (qualche migliaio di elementi = pochi MB, confronto in millisecondi).
 * `hybridSearch` unisce parole (FTS5) e significato con la Reciprocal Rank Fusion.
 */

const BATCH = 32;
const g = globalThis as unknown as { __sbVec?: { model: string; ids: string[]; vecs: Float32Array[] } | null; __sbVecSync?: Promise<number> | null };

const docText = (i: { title: string; summary: string | null; tags: string[]; content: string }) =>
  [i.title, i.summary, i.tags.length ? "Tag: " + i.tags.join(", ") : "", i.content.slice(0, 3000)].filter(Boolean).join("\n");

async function embed(texts: string[], task: string): Promise<Float32Array[]> {
  const cfg = await getAiConfig();
  if (!cfg.apiKey) throw new Error("IA non configurata.");
  const res = await fetch(`${OPENROUTER_URL}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", "X-Title": "Second Brain" },
    body: JSON.stringify({
      model: cfg.models.embed,
      input: texts,
      usage: { include: true },
      provider: { data_collection: cfg.dataCollection, ...(cfg.privacy === "zdr" ? { zdr: true } : {}) },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.data) throw new Error(`Embedding: ${data?.error?.message ?? res.status}`);
  await db.insert(aiUsage).values({
    at: new Date(), task, tier: "embed", model: cfg.models.embed,
    tokensIn: Number(data.usage?.prompt_tokens ?? 0), tokensOut: 0, cost: Number(data.usage?.cost ?? 0),
  }).catch(() => {});
  return (data.data as { index: number; embedding: number[] }[]).sort((a, b) => a.index - b.index).map((d) => normalize(Float32Array.from(d.embedding)));
}

function normalize(v: Float32Array) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Calcola le impronte mancanti o superate (testo cambiato, modello cambiato). Restituisce quante ne ha fatte. */
export function syncEmbeddings(max = 400): Promise<number> {
  g.__sbVecSync ??= (async () => {
    try {
      const cfg = await getAiConfig();
      if (!cfg.apiKey) return 0;
      const model = cfg.models.embed;
      const mem = await db.select({ id: items.id, title: items.title, summary: items.summary, tags: items.tags, content: items.content }).from(items).where(eq(items.status, "memory"));
      // Gli elementi usciti dalla memoria (archiviati, eliminati) perdono l'impronta.
      if (mem.length) await db.delete(embeddings).where(notInArray(embeddings.itemId, mem.map((m) => m.id)));
      else await db.delete(embeddings);
      const have = new Map((await db.select({ id: embeddings.itemId, hash: embeddings.hash }).from(embeddings)).map((r) => [r.id, r.hash]));
      const pending = mem
        .map((m) => ({ id: m.id, text: docText(m), hash: "" }))
        .map((m) => ({ ...m, hash: crypto.createHash("sha1").update(model + "\n" + m.text).digest("hex") }))
        .filter((m) => have.get(m.id) !== m.hash);
      const todo = pending.slice(0, max);
      for (let i = 0; i < todo.length; i += BATCH) {
        const part = todo.slice(i, i + BATCH);
        const vecs = await embed(part.map((p) => p.text), "indicizzazione");
        for (let k = 0; k < part.length; k++) {
          const v = vecs[k];
          const row = { model, hash: part[k].hash, dims: v.length, vec: Buffer.from(v.buffer, v.byteOffset, v.byteLength), updatedAt: new Date() };
          await db.insert(embeddings).values({ itemId: part[k].id, ...row }).onConflictDoUpdate({ target: embeddings.itemId, set: row });
        }
      }
      if (todo.length) g.__sbVec = null;
      await setSetting("embed_status", JSON.stringify({ at: Date.now(), model, done: mem.length - (pending.length - todo.length), total: mem.length, error: null }));
      return todo.length;
    } catch (e) {
      await setSetting("embed_status", JSON.stringify({ at: Date.now(), error: (e as Error).message })).catch(() => {});
      throw e;
    } finally {
      g.__sbVecSync = null;
    }
  })();
  return g.__sbVecSync;
}

async function vectors() {
  const model = (await getAiConfig()).models.embed;
  if (g.__sbVec?.model === model) return g.__sbVec;
  const rows = await db.select({ id: embeddings.itemId, vec: embeddings.vec }).from(embeddings).where(eq(embeddings.model, model));
  g.__sbVec = {
    model,
    ids: rows.map((r) => r.id),
    vecs: rows.map((r) => new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength))),
  };
  return g.__sbVec;
}

const queryCache = new Map<string, Float32Array>();

/** Elementi più vicini per significato alla richiesta (id e somiglianza da 0 a 1). */
export async function semanticSearch(query: string, limit = 30, within?: Set<string>): Promise<{ id: string; score: number }[]> {
  const q = query.trim().slice(0, 2000);
  if (!q) return [];
  const store = await vectors();
  if (!store.ids.length) return [];
  let qv = queryCache.get(q);
  if (!qv) {
    [qv] = await embed([q], "ricerca");
    queryCache.set(q, qv);
    if (queryCache.size > 200) queryCache.delete(queryCache.keys().next().value!);
  }
  const out: { id: string; score: number }[] = [];
  for (let i = 0; i < store.ids.length; i++) {
    if (within && !within.has(store.ids[i])) continue;
    const v = store.vecs[i];
    if (v.length !== qv.length) continue;
    let dot = 0;
    for (let k = 0; k < v.length; k++) dot += v[k] * qv[k];
    out.push({ id: store.ids[i], score: dot });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Parole + significato, fusi per posizione (RRF). Se il significato non è disponibile restano le parole. */
export async function hybridSearch(query: string, limit = 20, within?: Set<string>): Promise<string[]> {
  const [words, meaning] = await Promise.all([
    searchMemory(query, 60).then((ids) => (within ? ids.filter((id) => within.has(id)) : ids)),
    semanticSearch(query, 60, within).catch(() => [] as { id: string; score: number }[]),
  ]);
  const score = new Map<string, number>();
  words.forEach((id, r) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + r)));
  // Solo le somiglianze sensate: sotto una soglia minima il significato non aggiunge nulla.
  meaning.filter((m) => m.score > 0.2).forEach((m, r) => score.set(m.id, (score.get(m.id) ?? 0) + 1 / (60 + r)));
  return [...score].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}

/** Elementi simili a un testo (per la classificazione: collegamenti e conflitti anche tra elementi vecchi). */
export async function similarItems(text: string, limit = 12, exclude?: string): Promise<string[]> {
  const found = await hybridSearch(text.slice(0, 2000), limit + 1).catch(() => []);
  return found.filter((id) => id !== exclude).slice(0, limit);
}

/** Coppie di elementi molto simili per significato (candidati doppioni o collegamenti), dalla più simile. */
export async function similarPairs(min = 0.75, limit = 60): Promise<{ a: string; b: string; score: number }[]> {
  const store = await vectors();
  const n = Math.min(store.ids.length, 3000);
  const out: { a: string; b: string; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    const u = store.vecs[i];
    for (let j = i + 1; j < n; j++) {
      const v = store.vecs[j];
      if (v.length !== u.length) continue;
      let dot = 0;
      for (let k = 0; k < v.length; k++) dot += u[k] * v[k];
      if (dot >= min) out.push({ a: store.ids[i], b: store.ids[j], score: dot });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

export async function embeddingCount() {
  const rows = await db.select({ id: embeddings.itemId }).from(embeddings);
  return rows.length;
}

