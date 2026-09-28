import "server-only";
import { db, newId } from "./db";
import { attachments, items, type ItemKind } from "./db/schema";
import { fileKind, MAX_FILE_BYTES, saveFile } from "./files";
import { eq } from "drizzle-orm";
import { processAttachment, propose } from "./pipeline";
import { notifyReady } from "./push";
import { emit } from "./webhooks";

/** Lavoro in background: quando la proposta è pronta, avvisa con una notifica. */
function background(id: string, work: Promise<void>) {
  work
    .then(async () => {
      const [row] = await db.select({ status: items.status, title: items.title }).from(items).where(eq(items.id, id));
      if (row?.status === "ready") await notifyReady(row.title);
    })
    .catch((e) => console.error("[cattura]", e));
}

/** Nuovo elemento di testo o link in Inbox. `wait` false: la classificazione prosegue in background. */
export async function captureText(text: string, opts: { kind: ItemKind; source: string; origin?: string; title?: string; wait?: boolean }) {
  const id = newId("it");
  const now = new Date();
  await db.insert(items).values({
    id, kind: opts.kind, status: "processing", title: (opts.title || text.split("\n")[0]).slice(0, 120), content: text,
    source: opts.source, origin: opts.origin ?? (opts.kind === "link" ? "Link" : "Inbox"), createdAt: now, updatedAt: now,
  });
  emit("item.captured", { id, kind: opts.kind, title: (opts.title || text.split("\n")[0]).slice(0, 120), source: opts.source });
  const work = propose(id, text);
  if (opts.wait === false) background(id, work); else await work;
  return id;
}

/** Nuovo elemento da un file (foto, PDF, audio). Restituisce l'id oppure un errore da mostrare. */
export async function captureUpload(file: File, note: string, opts: { source?: string; wait?: boolean } = {}): Promise<{ id: string } | { error: string; status: number }> {
  if (!file.size) return { error: "Nessun file.", status: 400 };
  if (file.size > MAX_FILE_BYTES) return { error: "File troppo grande: il massimo è 20 MB.", status: 413 };
  const mime = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "");
  const kind = fileKind(mime);
  if (!kind) return { error: "Tipo di file non supportato. Puoi allegare foto, PDF e audio.", status: 415 };

  const id = newId("it");
  const attId = newId("fi");
  const now = new Date();
  await saveFile(attId, Buffer.from(await file.arrayBuffer()));
  await db.insert(items).values({
    id, kind: kind === "audio" ? "audio" : "file", status: "processing", title: file.name.slice(0, 120), content: note,
    source: opts.source ?? (kind === "audio" ? "Registrazione" : kind === "pdf" ? "Documento PDF" : "Foto"), origin: "Inbox", createdAt: now, updatedAt: now,
  });
  await db.insert(attachments).values({ id: attId, itemId: id, name: file.name.slice(0, 200), mime, size: file.size, createdAt: now });
  emit("item.captured", { id, kind: kind === "audio" ? "audio" : "file", title: file.name.slice(0, 120), source: opts.source ?? null });
  const work = processAttachment(id, note);
  if (opts.wait === false) background(id, work); else await work;
  return { id };
}
