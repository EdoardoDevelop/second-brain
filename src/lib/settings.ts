import "server-only";
import { inArray } from "drizzle-orm";
import { db, ready } from "./db";
import { settings } from "./db/schema";
import { parseLook, type Look } from "./theme";
import { parseProfile, type Profile } from "./profile";

export const DEFAULT_MODEL = "google/gemini-3.5-flash-lite";

/**
 * Modelli per compito:
 * - fast: lavori di routine su testo (classificazione, notizie);
 * - files: lettura di foto, PDF e audio (deve accettarli);
 * - smart: ragionamento (Assistente, comandi, sintesi, riepiloghi, suggerimenti);
 * - expert: «Pensa meglio», su richiesta per la singola domanda;
 * - embed: impronte di significato per la ricerca semantica.
 */
export type AiTier = "fast" | "files" | "smart" | "expert";
export type AiModels = Record<AiTier | "embed", string>;
export const DEFAULT_MODELS: Omit<AiModels, "fast" | "files"> = {
  smart: "deepseek/deepseek-v4-pro",
  expert: "anthropic/claude-sonnet-5",
  embed: "google/gemini-embedding-2",
};

/** Privacy dei fornitori: zdr = conservazione zero; deny = niente conservazione né addestramento; allow = tutti. */
export type AiPrivacy = "zdr" | "deny" | "allow";

export type AiConfig = {
  apiKey: string | null;
  /** Da dove arriva la chiave: impostata nell'app, dal .env, o assente. */
  keySource: "app" | "env" | null;
  /** Modello "fast" (compatibilità con il vecchio modello unico). */
  model: string;
  models: AiModels;
  privacy: AiPrivacy;
  dataCollection: "allow" | "deny";
  /** Tetto di spesa mensile in euro (0 = nessun tetto). */
  budgetEur: number;
};

/** Configurazione IA: i valori salvati dalle Impostazioni hanno la precedenza sul .env. */
export async function getAiConfig(): Promise<AiConfig> {
  await ready();
  const rows = await db.select().from(settings).where(inArray(settings.key, ["openrouter_key", "ai_model", "ai_data_collection", "ai_models", "ai_privacy", "ai_budget"]));
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const envKey = process.env.OPENROUTER_API_KEY || null;
  const fast = s.ai_model || process.env.AI_MODEL || DEFAULT_MODEL;
  let saved: Partial<AiModels> = {};
  try { saved = s.ai_models ? JSON.parse(s.ai_models) : {}; } catch { /* predefiniti */ }
  const pick = (k: keyof AiModels, d: string) => (typeof saved[k] === "string" && saved[k]!.trim() ? saved[k]!.trim() : d);
  const dc = s.ai_data_collection ?? process.env.AI_DATA_COLLECTION;
  const privacy: AiPrivacy = s.ai_privacy === "zdr" || s.ai_privacy === "allow" || s.ai_privacy === "deny" ? s.ai_privacy : dc === "allow" ? "allow" : "deny";
  const budget = Number(s.ai_budget ?? 5);
  return {
    apiKey: s.openrouter_key || envKey,
    keySource: s.openrouter_key ? "app" : envKey ? "env" : null,
    model: fast,
    models: {
      fast,
      files: pick("files", fast),
      smart: pick("smart", DEFAULT_MODELS.smart),
      expert: pick("expert", DEFAULT_MODELS.expert),
      embed: pick("embed", DEFAULT_MODELS.embed),
    },
    privacy,
    dataCollection: privacy === "allow" ? "allow" : "deny",
    budgetEur: Number.isFinite(budget) && budget >= 0 ? budget : 5,
  };
}

export async function setSetting(key: string, value: string | null) {
  await ready();
  if (value === null) await db.delete(settings).where(inArray(settings.key, [key]));
  else await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** Chiave mascherata da mostrare nell'interfaccia (la chiave vera non lascia mai il server). */
export const maskKey = (k: string | null) => (k ? `${k.slice(0, 8)}…${k.slice(-4)}` : null);

/** Aspetto dell'app (tema), uguale su tutti i dispositivi. */
export async function getLook(): Promise<Look> {
  await ready();
  const [row] = await db.select().from(settings).where(inArray(settings.key, ["look"]));
  return parseLook(row?.value);
}

export async function getSetting(key: string): Promise<string | null> {
  await ready();
  const [row] = await db.select().from(settings).where(inArray(settings.key, [key]));
  return row?.value ?? null;
}

export async function getProfile(): Promise<Profile> {
  return parseProfile(await getSetting("profile"));
}
