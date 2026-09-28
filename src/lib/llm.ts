import "server-only";
import { desc, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { aiUsage, facts } from "./db/schema";
import { personaPrompt } from "./profile";
import { getAiConfig, getProfile, setSetting, type AiConfig, type AiTier } from "./settings";

/**
 * Punto unico delle chiamate a OpenRouter: sceglie il modello in base al compito (tier), applica la privacy
 * dei fornitori, registra token e costo in `ai_usage`, rispetta il tetto di spesa mensile e, se un modello
 * non ha fornitori compatibili con la privacy scelta, ripiega sul modello veloce (senza mai allentare la privacy).
 */

// Sostituibile per i test con un server finto.
export const OPENROUTER_URL = process.env.OPENROUTER_URL || "https://openrouter.ai/api/v1";

/** Cambio indicativo per mostrare e confrontare il tetto in euro (i costi di OpenRouter sono in dollari). */
export const EUR_PER_USD = 0.92;

export type ToolCall = { id: string; name: string; arguments: string };
export type LlmMessage =
  | { role: "system" | "user"; content: string | unknown[] }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type LlmTool = { type: "function"; function: { name: string; description: string; parameters: unknown } };

export type LlmResult = { content: string; toolCalls: ToolCall[]; model: string; tier: AiTier; cost: number; tokensIn: number; tokensOut: number };

export type LlmRequest = {
  tier: AiTier;
  /** Nome del compito, per il registro dei consumi. */
  task: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  /** Output JSON con schema (json_schema rigoroso). */
  schema?: { name: string; schema: unknown };
  maxTokens?: number;
  /** Temperatura di campionamento (predefinita del modello se assente). */
  temperature?: number;
  timeoutMs?: number;
  /** Testo in arrivo, pezzo per pezzo (attiva lo streaming). */
  onDelta?: (d: string) => void;
  /** Aggiunge al prompt di sistema profilo, tono e fatti confermati sull'utente (predefinito sì). */
  persona?: boolean;
  /** Modello esplicito (confronto modelli): salta la scelta per tier, il tetto e il ripiego. */
  model?: string;
  signal?: AbortSignal;
};

/** Spesa del mese corrente (dollari). */
export async function monthSpendUsd(): Promise<number> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const [row] = await db.select({ total: sql<number>`coalesce(sum(${aiUsage.cost}), 0)` }).from(aiUsage).where(gte(aiUsage.at, start));
  return Number(row?.total ?? 0);
}

export type BudgetState = { spentEur: number; budgetEur: number; ratio: number; over: boolean; near: boolean };

export async function budgetState(cfg?: AiConfig): Promise<BudgetState> {
  const c = cfg ?? (await getAiConfig());
  const spentEur = (await monthSpendUsd()) * EUR_PER_USD;
  const ratio = c.budgetEur > 0 ? spentEur / c.budgetEur : 0;
  return { spentEur, budgetEur: c.budgetEur, ratio, over: c.budgetEur > 0 && ratio >= 1, near: c.budgetEur > 0 && ratio >= 0.8 };
}

/** Profilo, tono e fatti confermati: aggiunti al prompt di sistema. */
export async function userContext(): Promise<string> {
  const [profile, fs] = await Promise.all([
    getProfile(),
    db.select({ text: facts.text, status: facts.status, validUntil: facts.validUntil }).from(facts).orderBy(desc(facts.createdAt)).limit(120),
  ]);
  const current = fs.filter((f) => f.status === "confirmed").slice(0, 60);
  const past = fs.filter((f) => f.status === "obsolete").slice(0, 15);
  const fmt = (d: string) => d.split("-").reverse().join("/");
  const known = current.length ? `\nFatti confermati dall'utente su di sé (usali quando sono utili, non ripeterli a vuoto):\n${current.map((f) => "- " + f.text).join("\n")}` : "";
  const history = past.length ? `\nNon più veri (solo storia: non usarli come situazione attuale):\n${past.map((f) => `- ${f.text}${f.validUntil ? ` (fino al ${fmt(f.validUntil)})` : ""}`).join("\n")}` : "";
  return personaPrompt(profile) + known + history;
}

/** Errori che indicano un modello non utilizzabile con queste impostazioni (e non un problema passeggero). */
const UNAVAILABLE = /no endpoints|no allowed providers|data policy|zdr|not a valid model|model .*not (found|exist)|does not exist|no provider|guardrail|not available/i;

export class LlmError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

async function send(req: LlmRequest, cfg: AiConfig, model: string, tier: AiTier): Promise<LlmResult> {
  const system = req.messages[0]?.role === "system" && req.persona !== false
    ? [{ ...req.messages[0], content: `${req.messages[0].content}\n\n${await userContext()}` } as LlmMessage, ...req.messages.slice(1)]
    : req.messages;
  const stream = !!req.onDelta;
  const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", "X-Title": "Second Brain" },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 4000,
      ...(req.temperature != null ? { temperature: req.temperature } : {}),
      messages: system,
      ...(req.tools?.length ? { tools: req.tools, tool_choice: "auto" } : {}),
      ...(req.schema ? { response_format: { type: "json_schema", json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema } } } : {}),
      ...(stream ? { stream: true } : {}),
      usage: { include: true },
      provider: {
        data_collection: cfg.dataCollection,
        ...(cfg.privacy === "zdr" ? { zdr: true } : {}),
        ...(req.schema || req.tools?.length ? { require_parameters: true } : {}),
      },
    }),
    signal: req.signal ?? AbortSignal.timeout(req.timeoutMs ?? ((req.maxTokens ?? 4000) > 4000 ? 240_000 : 120_000)),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new LlmError(`OpenRouter: ${data?.error?.message ?? res.status + " " + res.statusText}`, res.status);
  }

  let content = "";
  const calls = new Map<number, ToolCall>();
  let usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
  let finish: string | undefined;

  if (!stream) {
    const data = await res.json().catch(() => null);
    if (!data) throw new LlmError("OpenRouter: risposta non leggibile.");
    if (data.error) throw new LlmError(`OpenRouter: ${data.error.message ?? "errore"}`, data.error.code);
    const choice = data.choices?.[0];
    finish = choice?.finish_reason;
    content = choice?.message?.content ?? "";
    (choice?.message?.tool_calls ?? []).forEach((c: { id: string; function: { name: string; arguments: string } }, i: number) =>
      calls.set(i, { id: c.id || `call_${i}`, name: c.function.name, arguments: c.function.arguments || "{}" }));
    usage = data.usage;
  } else {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        // Le righe che iniziano con ":" sono commenti di OpenRouter (": OPENROUTER PROCESSING").
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let j: {
          error?: { message?: string };
          usage?: typeof usage;
          choices?: { finish_reason?: string; delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        };
        try { j = JSON.parse(payload); } catch { continue; }
        if (j.error) throw new LlmError(`OpenRouter: ${j.error.message ?? "errore"}`);
        if (j.usage) usage = j.usage;
        const ch = j.choices?.[0];
        if (ch?.finish_reason) finish = ch.finish_reason;
        const d = ch?.delta?.content;
        if (d) { content += d; req.onDelta!(d); }
        for (const tc of ch?.delta?.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { id: "", name: "", arguments: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          calls.set(tc.index, cur);
        }
      }
    }
  }

  const out: LlmResult = {
    content,
    toolCalls: [...calls.values()].filter((c) => c.name).map((c, i) => ({ ...c, id: c.id || `call_${i}`, arguments: c.arguments || "{}" })),
    model, tier,
    cost: Number(usage?.cost ?? 0),
    tokensIn: Number(usage?.prompt_tokens ?? 0),
    tokensOut: Number(usage?.completion_tokens ?? 0),
  };
  await db.insert(aiUsage).values({ at: new Date(), task: req.task, tier, model, tokensIn: out.tokensIn, tokensOut: out.tokensOut, cost: out.cost }).catch(() => {});
  if (finish === "length" && !out.toolCalls.length) throw new LlmError("Risposta dell'IA troncata.");
  return out;
}

/** Modelli trovati non disponibili (per la privacy scelta o inesistenti): per 30 minuti si va dritti al ripiego. */
const unavailable = new Map<string, number>();
const UNAVAILABLE_TTL = 30 * 60_000;

/** Chiamata all'IA con scelta del modello, tetto di spesa e ripiego. */
export async function callLLM(req: LlmRequest): Promise<LlmResult> {
  const cfg = await getAiConfig();
  if (!cfg.apiKey) throw new LlmError("IA non configurata: imposta la chiave OpenRouter nelle Impostazioni.");
  if (req.model) return send(req, cfg, req.model, req.tier);

  let tier = req.tier;
  // Oltre il tetto mensile il ragionamento passa al modello veloce.
  if ((tier === "smart" || tier === "expert") && cfg.budgetEur > 0 && (await budgetState(cfg)).over) tier = "fast";
  const model = cfg.models[tier];
  const fallback = tier === "smart" || tier === "expert" ? cfg.models.fast : null;
  if (fallback && fallback !== model && (unavailable.get(model + "|" + cfg.privacy) ?? 0) > Date.now()) return send(req, cfg, fallback, "fast");
  try {
    return await send(req, cfg, model, tier);
  } catch (e) {
    const err = e as LlmError;
    if (fallback && fallback !== model && (UNAVAILABLE.test(err.message) || err.status === 404)) {
      unavailable.set(model + "|" + cfg.privacy, Date.now() + UNAVAILABLE_TTL);
      await setSetting("ai_warning", JSON.stringify({ at: Date.now(), model, tier, message: err.message })).catch(() => {});
      return send(req, cfg, fallback, "fast");
    }
    throw err;
  }
}

/** Dopo un cambio di impostazioni si riprovano tutti i modelli. */
export function resetUnavailable() {
  unavailable.clear();
}

/** Output JSON validato da una funzione (Zod `safeParse`). */
export async function callJSON<T>(req: Omit<LlmRequest, "schema" | "onDelta"> & { name: string; jsonSchema: unknown; parse: (v: unknown) => { success: true; data: T } | { success: false } }): Promise<T> {
  const r = await callLLM({ ...req, schema: { name: req.name, schema: req.jsonSchema } });
  // Alcuni modelli racchiudono il JSON in un blocco di codice: si estrae l'oggetto.
  const json = r.content.slice(r.content.indexOf("{"), r.content.lastIndexOf("}") + 1);
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new LlmError("Risposta dell'IA non leggibile."); }
  const out = req.parse(parsed);
  if (!out.success) throw new LlmError("Risposta dell'IA non valida.");
  return out.data;
}
