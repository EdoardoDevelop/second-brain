import "server-only";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, ready } from "./db";
import { webhooks } from "./db/schema";

export const WEBHOOK_EVENTS = {
  "item.captured": "Nuova cattura in Inbox",
  "item.confirmed": "Elemento confermato in memoria",
  "task.created": "Attività creata",
  "task.completed": "Attività completata",
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

/**
 * Avvisa i webhook iscritti a un evento. Non blocca chi la chiama: gli invii partono in background.
 * Corpo JSON { event, at, data }; firma HMAC-SHA256 del corpo nell'header X-SecondBrain-Signature ("sha256=…").
 */
export function emit(event: WebhookEvent, data: Record<string, unknown>) {
  (async () => {
    await ready();
    const hooks = (await db.select().from(webhooks)).filter((h) => h.events.includes(event));
    await Promise.all(hooks.map((h) => deliver(h.id, h.url, h.secret, event, data)));
  })().catch((e) => console.error("[webhook]", e));
}

export async function deliver(id: string, url: string, secret: string, event: string, data: Record<string, unknown>) {
  const body = JSON.stringify({ event, at: new Date().toISOString(), data });
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  let status: string;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "SecondBrain-Webhook/1", "X-SecondBrain-Event": event, "X-SecondBrain-Signature": `sha256=${sig}` },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = `${res.status}`;
  } catch (e) {
    status = "errore: " + (e instanceof Error ? e.message : "rete");
  }
  await db.update(webhooks).set({ lastStatus: status, lastAt: new Date() }).where(eq(webhooks.id, id));
  return status;
}
