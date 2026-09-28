import "server-only";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, newId } from "./db";
import { insights, items, links } from "./db/schema";
import { isoDay } from "./format";
import { budgetState, callJSON } from "./llm";
import { log } from "./pipeline";
import { similarPairs, syncEmbeddings } from "./semantic";
import { getAiConfig, getSetting, setSetting } from "./settings";

/**
 * Cura della memoria, ogni notte (e su richiesta dalle Impostazioni), con il modello veloce:
 * - da sola, perché aggiunge e non toglie nulla: collega gli elementi affini o in conflitto e uniforma i tag
 *   scritti in modi diversi (singolare/plurale, maiuscole, sinonimi evidenti);
 * - come proposta da confermare nella Home («Da riordinare»): unire i doppioni e archiviare ciò che è superato.
 * Tutto finisce nel registro IA. Le coppie già valutate non si ripropongono.
 */

export type GardenStatus = { at: number; linked: number; retagged: number; proposed: number; error: string | null };

const PairSchema = z.object({
  pairs: z.array(z.object({
    a: z.string(),
    b: z.string(),
    relation: z.enum(["duplicate", "supersedes", "related", "conflict", "none"])
      .describe("duplicate: parlano della stessa cosa e vanno uniti; supersedes: uno dei due rende superato l'altro; related: argomenti collegati; conflict: si contraddicono; none: niente di rilevante"),
    keep: z.enum(["a", "b"]).describe("duplicate: quello più completo, che resta; supersedes: quello più recente e valido"),
    reason: z.string().describe("Il perché in una frase breve, in italiano"),
  })),
});

const TagSchema = z.object({
  merges: z.array(z.object({ from: z.array(z.string()), to: z.string() }))
    .describe("Solo varianti dello stesso tag (singolare/plurale, refusi, maiuscole, sinonimi evidenti). Vuoto se non ce ne sono."),
});

const SEEN_MAX = 3000;

export async function gardenMemory(): Promise<GardenStatus> {
  const status: GardenStatus = { at: Date.now(), linked: 0, retagged: 0, proposed: 0, error: null };
  try {
    if (!(await getAiConfig()).apiKey) throw new Error("IA non configurata.");
    await syncEmbeddings().catch(() => 0);
    const mem = await db.select({ id: items.id, title: items.title, type: items.type, summary: items.summary, tags: items.tags, createdAt: items.createdAt }).from(items).where(eq(items.status, "memory"));
    const byId = new Map(mem.map((i) => [i.id, i]));

    // 1. Coppie simili mai valutate, senza un collegamento già esistente.
    const seen = new Set<string>(JSON.parse((await getSetting("garden_seen")) ?? "[]"));
    const linked = new Set((await db.select({ a: links.fromId, b: links.toId }).from(links)).flatMap((l) => [`${l.a}|${l.b}`, `${l.b}|${l.a}`]));
    const pairs = (await similarPairs(0.75, 80))
      .filter((p) => byId.has(p.a) && byId.has(p.b) && !seen.has(`${p.a}|${p.b}`) && !linked.has(`${p.a}|${p.b}`))
      .slice(0, 20);

    const cards: { title: string; body: string; refs: string[]; actions: Record<string, unknown>[] }[] = [];
    if (pairs.length) {
      const view = (id: string) => { const i = byId.get(id)!; return { id, tipo: i.type, titolo: i.title, sintesi: i.summary, tag: i.tags, data: isoDay(i.createdAt) }; };
      const out = await callJSON<z.infer<typeof PairSchema>>({
        tier: "fast", task: "cura_memoria", name: "cura_memoria", maxTokens: 3000, temperature: 0, persona: false,
        messages: [
          { role: "system", content: "Riordini la memoria di un Second Brain personale in italiano. Per ogni coppia di elementi simili decidi la relazione. Sii prudente: duplicate e supersedes solo se è evidente; nel dubbio related o none." },
          { role: "user", content: JSON.stringify(pairs.map((p) => ({ a: view(p.a), b: view(p.b) }))) },
        ],
        jsonSchema: z.toJSONSchema(PairSchema),
        parse: (v) => PairSchema.safeParse(v) as { success: true; data: z.infer<typeof PairSchema> } | { success: false },
      });
      for (const r of out.pairs) {
        if (!byId.has(r.a) || !byId.has(r.b) || r.a === r.b) continue;
        const [keep, other] = r.keep === "b" ? [r.b, r.a] : [r.a, r.b];
        const A = byId.get(keep)!, B = byId.get(other)!;
        if (r.relation === "related" || r.relation === "conflict") {
          await db.insert(links).values({ fromId: r.a, toId: r.b, kind: r.relation, reason: r.reason.slice(0, 200) }).onConflictDoNothing();
          status.linked++;
        } else if (r.relation === "duplicate") {
          cards.push({
            title: `«${B.title}» sembra un doppione di «${A.title}»`, body: r.reason, refs: [keep, other],
            actions: [{ kind: "merge_items", label: `Unisci «${B.title}» in «${A.title}»`, itemId: keep, targetId: other, reason: r.reason }],
          });
        } else if (r.relation === "supersedes") {
          cards.push({
            title: `«${B.title}» sembra superato da «${A.title}»`, body: r.reason, refs: [keep, other],
            actions: [{ kind: "archive_item", label: `Archivia «${B.title}»`, itemId: other }],
          });
        }
      }
      for (const p of pairs) seen.add(`${p.a}|${p.b}`);
      await setSetting("garden_seen", JSON.stringify([...seen].slice(-SEEN_MAX)));
    }

    // 2. Tag scritti in modi diversi: uniformati da soli.
    const counts = new Map<string, number>();
    for (const i of mem) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    if (counts.size >= 4) {
      const out = await callJSON<z.infer<typeof TagSchema>>({
        tier: "fast", task: "cura_memoria", name: "tag", maxTokens: 1500, temperature: 0, persona: false,
        messages: [
          { role: "system", content: "Uniforma i tag di un Second Brain in italiano: raggruppa solo le varianti dello stesso concetto e scegli come forma finale la più usata (minuscola). Non unire concetti diversi anche se vicini." },
          { role: "user", content: JSON.stringify([...counts].map(([tag, n]) => ({ tag, n }))) },
        ],
        jsonSchema: z.toJSONSchema(TagSchema),
        parse: (v) => TagSchema.safeParse(v) as { success: true; data: z.infer<typeof TagSchema> } | { success: false },
      });
      const map = new Map<string, string>();
      for (const m of out.merges) {
        const to = m.to.trim().toLowerCase().replace(/^#/, "");
        for (const f of m.from) if (counts.has(f) && f !== to) map.set(f, to);
      }
      if (map.size) {
        for (const i of mem) {
          if (!i.tags.some((t) => map.has(t))) continue;
          await db.update(items).set({ tags: [...new Set(i.tags.map((t) => map.get(t) ?? t))] }).where(eq(items.id, i.id));
          status.retagged++;
        }
        await log("Cura della memoria: tag uniformati", null, [...map].map(([f, t]) => `#${f} → #${t}`).join(", "));
      }
    }

    // 3. Proposte da confermare nella Home (sostituiscono quelle precedenti non ancora viste).
    await db.update(insights).set({ status: "dismissed" }).where(and(eq(insights.status, "new"), eq(insights.kind, "cleanup")));
    const day = isoDay();
    for (const c of cards.slice(0, 5)) {
      const refs = c.refs.map((id) => ({ id, title: byId.get(id)!.title, href: `/conoscenza/${id}` }));
      await db.insert(insights).values({ id: newId("in"), day, kind: "cleanup", title: c.title.slice(0, 140), body: c.body.slice(0, 500), actions: c.actions, refs, status: "new", createdAt: new Date() });
      status.proposed++;
    }
    await log("Cura della memoria", null, `${status.linked} collegamenti aggiunti · ${status.retagged} elementi con tag uniformati · ${status.proposed} proposte da confermare`);
  } catch (e) {
    status.error = e instanceof Error ? e.message : "Errore";
    await log("Cura della memoria", null, "Errore: " + status.error).catch(() => {});
  }
  await setSetting("garden_status", JSON.stringify(status)).catch(() => {});
  return status;
}

export async function gardenStatus(): Promise<GardenStatus | null> {
  try { return JSON.parse((await getSetting("garden_status")) ?? "null"); } catch { return null; }
}

/** Dal pianificatore (ogni minuto): una volta per notte, dopo le 3 (ora italiana), se il budget lo consente. */
export async function gardenTick() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hour12: false }).format(new Date()));
  const today = isoDay();
  if (hour < 3 || (await getSetting("garden_last")) === today) return;
  await setSetting("garden_last", today);
  if (!(await getAiConfig()).apiKey || (await budgetState()).near) return;
  const count = await db.select({ id: items.id }).from(items).where(eq(items.status, "memory"));
  if (count.length < 2) return;
  await gardenMemory();
}
