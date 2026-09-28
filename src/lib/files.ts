import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

/** Cartella degli allegati: dentro data/, quindi esclusa dal pacchetto di deploy come il database. */
export const FILES_DIR = process.env.FILES_DIR ?? path.join(process.cwd(), "data", "files");
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const file = (id: string) => path.join(FILES_DIR, id.replace(/[^\w-]/g, ""));

export async function saveFile(id: string, data: Buffer) {
  await fs.mkdir(FILES_DIR, { recursive: true });
  await fs.writeFile(file(id), data);
}

export const readStoredFile = (id: string) => fs.readFile(file(id));

export async function removeFiles(ids: string[]) {
  await Promise.all(ids.map((id) => fs.rm(file(id), { force: true })));
}

/** Tipi accettati in Inbox. */
export function fileKind(mime: string): "image" | "pdf" | "audio" | null {
  if (/^image\/(png|jpe?g|webp|gif|heic|heif)$/.test(mime)) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/") || mime === "video/webm") return "audio";
  return null;
}
