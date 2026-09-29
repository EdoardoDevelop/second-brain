import "server-only";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db, newId } from "./db";
import { facts, insights, items, links, type Why } from "./db/schema";
import { createHash } from "node:crypto";
import type { CommandAction } from "./ai";
import { isoDay, shortDate } from "./format";
import { STALE_DAYS } from "./fact-age";
import { budgetState, callJSON } from "./llm";
import { log } from "./pipeline";
import { similarPairs, syncEmbeddings } from "./semantic";
import { getAiConfig, getSetting, setSetting } from "./settings";

/**
 * Cura della memoria, ogni notte (e su richiesta dalle Impostazioni), con il modello veloce:
 * - da sola, perché aggiunge e non toglie nulla: collega gli elementi affini o in conflitto e uniforma i tag
 *   scritti in modi diversi (singolare/plurale, maiuscole, sinonimi evidenti);
 * - come proposta da confermare nella Home («Da riordinare»): unire i doppioni e archiviare ciò che è superato;
 * - lo stesso per i fatti su di te: doppioni da unire, contraddizioni da risolvere, fatti vecchi da riconfermare.
 *   I fatti non si toccano mai da soli: né stato né testo cambiano senza conferma.
 * Tutto finisce nel registro IA. Le coppie già valutate non si ripropongono.
 */

export type GardenStatus = { at: number; linked: number; retagged: number; proposed: number; facts?: number; error: string | null };

type Card = { title: string; body: string; refs: { id: string; title: string; href: string }[]; actions: CommandAction[]; why: Why[] };

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

const FactSchema = z.object({
  duplicates: z.array(z.object({
    keep: z.string().describe("id del fatto che resta (il più completo)"),
    drop: z.string().describe("id del doppione da togliere"),
    text: z.string().nullable().describe("Formulazione unita, se il doppione aggiunge un dettaglio; altrimenti null"),
    reason: z.string(),
  })).describe("Solo fatti che dicono la stessa cosa"),
  conflicts: z.array(z.object({
    a: z.string(), b: z.string(),
    current: z.enum(["a", "b", "unknown"]).describe("Quale dei due è probabilmente vero oggi (di solito il più recente); unknown se non si può dire"),
    reason: z.string(),
  })).describe("Fatti che non possono essere veri insieme (es. due lavori attuali diversi)"),
  outdated: z.array(z.object({ id: z.string(), reason: z.string() }))
    .describe("Fatti legati a un momento che oggi è probabilmente passato (es. «sto cercando casa» di molti mesi fa, un evento con una data già trascorsa)"),
});

const SEEN_MAX = 3000;
/** Oltre questo tempo senza conferme un fatto è «forse superato» (fact-age.ts, come in Cosa so di te). */
const STALE_MS = STALE_DAYS * 86400000;
const MAX_FACT_CARDS = 3;

export async function gardenMemory(): Promise<GardenStatus> {
  const status: GardenStatus = { at: Date.now(), linked: 0, retagged: 0, proposed: 0, error: null };
  try {
    if (!(await getAiConfig()).apiKey) throw new Error("IA non configurata.");
    await syncEmbeddings().catch(() => 0);
    const mem = await db.select({ id: items.id, title: items.title, type: items.type, summary: items.summary, tags: items.tags, projectId: items.projectId, createdAt: items.createdAt }).from(items).where(eq(items.status, "memory"));
    const byId = new Map(mem.map((i) => [i.id, i]));

    // 1. Coppie simili mai valutate, senza un collegamento già esistente.
    const seen = new Set<string>(JSON.parse((await getSetting("garden_seen")) ?? "[]"));
    const linked = new Set((await db.select({ a: links.fromId, b: links.toId }).from(links)).flatMap((l) => [`${l.a}|${l.b}`, `${l.b}|${l.a}`]));
    const pairs = (await similarPairs(0.75, 80))
      .filter((p) => byId.has(p.a) && byId.has(p.b) && !seen.has(`${p.a}|${p.b}`) && !linked.has(`${p.a}|${p.b}`))
      .slice(0, 20);

    const cards: Card[] = [];
    const ref = (id: string) => ({ id, title: byId.get(id)!.title, href: `/conoscenza/${id}` });
    const score = new Map(pairs.flatMap((p) => [[`${p.a}|${p.b}`, p.score], [`${p.b}|${p.a}`, p.score]] as [string, number][]));
    /** I dati che hanno fatto notare la coppia: somiglianza, tipi e date, tag e progetto in comune. */
    const pairWhy = (a: string, b: string): Why[] => {
      const A = byId.get(a)!, B = byId.get(b)!;
      const common = A.tags.filter((t) => B.tags.includes(t));
      const out: Why[] = [{ text: `Contenuto simile al ${Math.round((score.get(`${a}|${b}`) ?? 0) * 100)}% (ricerca per significato)` }];
      for (const x of [A, B]) out.push({ text: `«${x.title}»: ${x.type ?? "Nota"} del ${shortDate(x.createdAt)}`, href: `/conoscenza/${x.id}` });
      if (common.length) out.push({ text: `Tag in comune: ${common.map((t) => "#" + t).join(" ")}` });
      if (A.projectId && A.projectId === B.projectId) out.push({ text: "Stesso progetto" });
      return out;
    };
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
            title: `«${B.title}» sembra un doppione di «${A.title}»`, body: r.reason, refs: [ref(keep), ref(other)],
            actions: [{ kind: "merge_items", label: `Unisci «${B.title}» in «${A.title}»`, itemId: keep, targetId: other, reason: r.reason } as CommandAction], why: pairWhy(keep, other),
          });
        } else if (r.relation === "supersedes") {
          cards.push({
            title: `«${B.title}» sembra superato da «${A.title}»`, body: r.reason, refs: [ref(keep), ref(other)],
            actions: [{ kind: "archive_item", label: `Archivia «${B.title}»`, itemId: other } as CommandAction], why: [...pairWhy(keep, other), { text: `«${A.title}» è più recente o più completo` }],
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

    // 3. Fatti su di te: solo proposte.
    // Un errore qui non deve far perdere le proposte sugli elementi.
    const factCards = await gardenFacts().catch(async (e: unknown) => {
      await log("Cura della memoria: fatti", null, "Errore: " + (e instanceof Error ? e.message : "errore"));
      return [] as Card[];
    });
    status.facts = factCards.length;

    // 4. Proposte da confermare nella Home (sostituiscono quelle precedenti non ancora viste).
    await db.update(insights).set({ status: "dismissed" }).where(and(eq(insights.status, "new"), eq(insights.kind, "cleanup")));
    const day = isoDay();
    for (const c of [...factCards, ...cards.slice(0, 5)]) {
      await db.insert(insights).values({ id: newId("in"), day, kind: "cleanup", title: c.title.slice(0, 140), body: c.body.slice(0, 500), actions: c.actions, refs: c.refs, why: c.why, status: "new", createdAt: new Date() });
      status.proposed++;
    }
    await log("Cura della memoria", null, `${status.linked} collegamenti aggiunti · ${status.retagged} elementi con tag uniformati · ${status.proposed} proposte da confermare (${status.facts} sui fatti)`);
  } catch (e) {
    status.error = e instanceof Error ? e.message : "Errore";
    await log("Cura della memoria", null, "Errore: " + status.error).catch(() => {});
  }
  await setSetting("garden_status", JSON.stringify(status)).catch(() => {});
  return status;
}

/**
 * Controlla i fatti su di te: doppioni e contraddizioni (con il modello veloce, solo se i fatti sono cambiati
 * dall'ultima volta) e fatti da riconfermare (senza conferme da oltre 180 giorni, o legati a un momento ormai passato).
 * Ogni proposta si fa una volta sola: le chiavi già proposte stanno in `settings.garden_facts_seen`.
 */
async function gardenFacts(): Promise<Card[]> {
  const list = await db.select().from(facts).where(inArray(facts.status, ["confirmed", "pending", "conflict"]));
  if (!list.length) return [];
  const byId = new Map(list.map((f) => [f.id, f]));
  const seen = new Set<string>(JSON.parse((await getSetting("garden_facts_seen")) ?? "[]"));
  const pairKey = (a: string, b: string) => "p:" + [a, b].sort().join("|");
  // La chiave cambia a ogni conferma: un fatto riconfermato potrà essere richiesto di nuovo fra sei mesi.
  const staleKey = (id: string) => `s:${id}:${byId.get(id)!.lastConfirmedAt?.getTime() ?? 0}`;
  const used = new Set<string>();
  const cards: Card[] = [];
  const quote = (id: string) => `«${byId.get(id)!.text}»`;
  const factWhy = (id: string, extra = ""): Why => {
    const f = byId.get(id)!;
    const last = f.lastConfirmedAt ?? f.createdAt;
    const confirmed = last.getTime() !== f.createdAt.getTime() ? `, ultima conferma il ${shortDate(last)}` : "";
    return { text: `${quote(id)}: ricordato il ${shortDate(f.createdAt)}${confirmed}${extra}`, href: "/memoria" };
  };

  // Doppioni e contraddizioni: l'IA li cerca solo quando l'elenco dei fatti è cambiato.
  const hash = createHash("sha1").update(list.map((f) => `${f.id}:${f.text}`).sort().join("\n")).digest("hex");
  const outdated: { id: string; reason: string }[] = [];
  if ((await getSetting("garden_facts_hash")) !== hash) {
    const out = await callJSON<z.infer<typeof FactSchema>>({
      tier: "fast", task: "cura_fatti", name: "cura_fatti", maxTokens: 2500, temperature: 0, persona: false,
      messages: [
        { role: "system", content: `Controlli i fatti che l'utente di un Second Brain ha confermato su di sé. Oggi è il ${isoDay()}. Trova i doppioni (stessa informazione detta due volte), le contraddizioni (non possono essere veri insieme) e i fatti legati a un momento probabilmente passato. Sii prudente: fatti diversi sullo stesso argomento non sono doppioni né contraddizioni (es. «lavora in X» e «in X si occupa di Y» stanno bene insieme). Nel dubbio non segnalare nulla.` },
        { role: "user", content: JSON.stringify(list.map((f) => ({ id: f.id, testo: f.text, dal: f.validFrom ?? isoDay(f.createdAt), ultima_conferma: isoDay(f.lastConfirmedAt ?? f.createdAt) }))) },
      ],
      jsonSchema: z.toJSONSchema(FactSchema),
      parse: (v) => FactSchema.safeParse(v) as { success: true; data: z.infer<typeof FactSchema> } | { success: false },
    });
    await setSetting("garden_facts_hash", hash);

    for (const d of out.duplicates) {
      if (!byId.has(d.keep) || !byId.has(d.drop) || d.keep === d.drop || used.has(d.keep) || used.has(d.drop) || seen.has(pairKey(d.keep, d.drop))) continue;
      seen.add(pairKey(d.keep, d.drop)); used.add(d.keep); used.add(d.drop);
      const text = d.text?.trim() && d.text.trim() !== byId.get(d.keep)!.text ? d.text.trim() : null;
      cards.push({
        title: "Due fatti su di te dicono la stessa cosa", body: d.reason, refs: [],
        actions: [{ kind: "merge_facts", label: `Tieni ${text ? `«${text}»` : quote(d.keep)} e togli il doppione`, factId: d.keep, otherFactId: d.drop, text } as CommandAction],
        why: [factWhy(d.keep), factWhy(d.drop)],
      });
    }
    for (const c of out.conflicts) {
      if (!byId.has(c.a) || !byId.has(c.b) || c.a === c.b || used.has(c.a) || used.has(c.b) || seen.has(pairKey(c.a, c.b))) continue;
      seen.add(pairKey(c.a, c.b)); used.add(c.a); used.add(c.b);
      // Prima l'ipotesi dell'IA (spuntata), poi l'alternativa; se non sa quale sia vero oggi, nessuna spunta.
      const [now, old] = c.current === "a" ? [c.a, c.b] : [c.b, c.a];
      const pick = c.current !== "unknown";
      cards.push({
        title: "Due fatti su di te si contraddicono", body: `${c.reason}${pick ? "" : " Scegli quale è vero oggi."}`, refs: [],
        actions: [
          { kind: "end_fact", label: `Oggi vale ${quote(now)}: l'altro diventa storia`, factId: old, otherFactId: now, on: pick } as CommandAction,
          { kind: "end_fact", label: `Oggi vale ${quote(old)}: l'altro diventa storia`, factId: now, otherFactId: old, on: false } as CommandAction,
        ],
        why: [factWhy(now), factWhy(old)],
      });
    }
    outdated.push(...out.outdated.filter((o) => byId.has(o.id) && byId.get(o.id)!.status === "confirmed"));
  }

  // Da riconfermare: quelli che l'IA vede legati al passato e quelli senza conferme da oltre sei mesi.
  const reasons = new Map(outdated.map((o) => [o.id, o.reason]));
  for (const f of list) {
    if (f.status === "confirmed" && Date.now() - (f.lastConfirmedAt ?? f.createdAt).getTime() > STALE_MS && !reasons.has(f.id)) reasons.set(f.id, "");
  }
  const stale = [...reasons].filter(([id]) => !used.has(id) && !seen.has(staleKey(id))).slice(0, 5);
  if (stale.length && cards.length < MAX_FACT_CARDS) {
    for (const [id] of stale) seen.add(staleKey(id));
    const months = (id: string) => Math.floor((Date.now() - (byId.get(id)!.lastConfirmedAt ?? byId.get(id)!.createdAt).getTime()) / (30 * 86400000));
    cards.push({
      title: stale.length === 1 ? `È ancora vero che ${byId.get(stale[0][0])!.text.replace(/\.$/, "")}?` : `${stale.length} fatti su di te da riconfermare`,
      body: "Spunta «Non più vero» per quelli che sono cambiati: resteranno come storia e l'IA smetterà di usarli come attuali.",
      refs: [],
      actions: stale.flatMap(([id]) => [
        { kind: "confirm_fact", label: `È ancora vero: ${quote(id)}`, factId: id } as CommandAction,
        { kind: "end_fact", label: `Non più vero: ${quote(id)}`, factId: id, on: false } as CommandAction,
      ]),
      why: stale.map(([id, reason]) => factWhy(id, reason ? ` · ${reason}` : ` · nessuna conferma da ${months(id)} mesi`)),
    });
  }
  await setSetting("garden_facts_seen", JSON.stringify([...seen].slice(-SEEN_MAX)));
  return cards.slice(0, MAX_FACT_CARDS);
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
  const known = await db.select({ id: facts.id }).from(facts).where(eq(facts.status, "confirmed")).limit(1);
  if (count.length < 2 && !known.length) return;
  await gardenMemory();
}
