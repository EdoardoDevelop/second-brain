import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { aiLog, attachments, items } from "./db/schema";
import { aiEnabled, classify, manualProposal, readFile, type MemoryContext } from "./ai";
import { memoryContext } from "./queries";
import { similarItems, syncEmbeddings } from "./semantic";
import { readStoredFile } from "./files";

export async function log(action: string, itemId: string | null, outcome: string) {
  await db.insert(aiLog).values({ at: new Date(), action, itemId, outcome });
}

/**
 * Contesto per la classificazione: gli 80 elementi più recenti più quelli simili per significato,
 * così collegamenti e conflitti si trovano anche con elementi vecchi.
 */
async function contextWithSimilar(id: string, content: string): Promise<MemoryContext> {
  const ctx = await memoryContext(id);
  const have = new Set(ctx.items.map((i) => i.id));
  const extra = (await similarItems(content, 12, id).catch(() => [] as string[])).filter((x) => !have.has(x));
  if (!extra.length) return ctx;
  const rows = await db.select({ id: items.id, type: items.type, title: items.title, summary: items.summary, createdAt: items.createdAt }).from(items).where(inArray(items.id, extra));
  return { ...ctx, items: [...rows.map((i) => ({ id: i.id, type: i.type, title: i.title, summary: i.summary, date: i.createdAt.toISOString().slice(0, 10) })), ...ctx.items] };
}

/** Aggiorna l'indice per significato in background (dopo una conferma o una modifica). */
export function reindexSoon() {
  syncEmbeddings().catch((e) => console.error("[indice]", e));
}

/** Chiede all'IA una proposta di archiviazione; senza IA prepara una proposta manuale. */
export async function propose(id: string, content: string) {
  if (!(await aiEnabled())) {
    await db.update(items).set({ status: "ready", proposal: manualProposal(content), updatedAt: new Date() }).where(eq(items.id, id));
    return;
  }
  try {
    const proposal = await classify(content, await contextWithSimilar(id, content));
    await db.update(items).set({ status: "ready", proposal, error: null, updatedAt: new Date() }).where(eq(items.id, id));
    await log("Classificazione proposta", id, "In attesa di conferma");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore sconosciuto";
    await db.update(items).set({ status: "error", error: msg, updatedAt: new Date() }).where(eq(items.id, id));
    await log("Classificazione", id, "Errore: " + msg);
  }
}

export const FILE_ERROR = "Lettura del file non riuscita: ";

/**
 * Elemento nato da un allegato: l'IA legge il file (trascrizione, testo, descrizione),
 * il testo diventa il contenuto e poi si classifica come una nota. `note` è il testo scritto dall'utente.
 */
export async function processAttachment(itemId: string, note: string) {
  const [att] = await db.select().from(attachments).where(eq(attachments.itemId, itemId));
  if (!att) return;
  if (!(await aiEnabled())) {
    const content = note || `File allegato: ${att.name}`;
    await db.update(items).set({ content, updatedAt: new Date() }).where(eq(items.id, itemId));
    await propose(itemId, content);
    return;
  }
  let read: { title: string; text: string };
  try {
    read = await readFile({ name: att.name, mime: att.mime, base64: (await readStoredFile(att.id)).toString("base64") });
    await log(att.mime.startsWith("audio/") ? "Trascrizione audio" : "Lettura file", itemId, "Eseguita");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore sconosciuto";
    await db.update(items).set({ status: "error", error: FILE_ERROR + msg, updatedAt: new Date() }).where(eq(items.id, itemId));
    await log("Lettura file", itemId, "Errore: " + msg);
    return;
  }
  const content = [note, read.text].filter(Boolean).join("\n\n");
  await db.update(items).set({ content, title: (read.title || att.name).slice(0, 120), updatedAt: new Date() }).where(eq(items.id, itemId));
  await propose(itemId, `${content}\n\n(Da file allegato: ${att.name})`);
}
