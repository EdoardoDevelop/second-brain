import "server-only";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, newId, ready } from "./db";
import { apiKeys } from "./db/schema";

export type ApiScope = "read" | "write";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Crea una chiave: il testo in chiaro si restituisce solo ora, nel database resta l'hash. */
export async function createApiKey(name: string, scope: ApiScope) {
  await ready();
  const secret = "sb_" + crypto.randomBytes(24).toString("base64url");
  const id = newId("ak");
  await db.insert(apiKeys).values({ id, name: name.trim().slice(0, 60) || "Chiave", prefix: secret.slice(0, 10), hash: sha(secret), scope, createdAt: new Date() });
  return { id, secret };
}

/**
 * Chiave della richiesta: header `Authorization: Bearer sb_…` (o `X-API-Key`), oppure `?key=` nell'indirizzo
 * (per i client che accettano solo un URL, come i connettori personalizzati di claude.ai).
 */
export async function authApi(req: Request, need: ApiScope): Promise<{ ok: true; scope: ApiScope; name: string } | { ok: false; status: number; error: string }> {
  await ready();
  const auth = req.headers.get("authorization") ?? "";
  const key = (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : req.headers.get("x-api-key") ?? new URL(req.url).searchParams.get("key") ?? "").trim();
  if (!key) return { ok: false, status: 401, error: "Chiave mancante: usa l'header Authorization: Bearer <chiave>." };
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.hash, sha(key)));
  if (!row) return { ok: false, status: 401, error: "Chiave non valida o revocata." };
  if (need === "write" && row.scope !== "write") return { ok: false, status: 403, error: "Questa chiave è in sola lettura." };
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return { ok: true, scope: row.scope, name: row.name };
}
