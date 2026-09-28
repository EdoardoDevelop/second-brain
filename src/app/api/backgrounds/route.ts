import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { db, newId, ready } from "@/lib/db";
import { backgrounds } from "@/lib/db/schema";
import { saveFile } from "@/lib/files";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

/** Carica un'immagine di sfondo. Multipart: `file`. */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) return Response.json({ error: "Non autorizzato" }, { status: 401 });
  await ready();
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "Nessun file." }, { status: 400 });
  if (!TYPES.includes(file.type)) return Response.json({ error: "Formato non supportato: usa JPG, PNG, WebP, GIF o AVIF." }, { status: 415 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Immagine troppo grande: il massimo è 10 MB." }, { status: 413 });
  const id = newId("bg");
  await saveFile(id, Buffer.from(await file.arrayBuffer()));
  await db.insert(backgrounds).values({ id, name: file.name.slice(0, 120) || "Immagine", mime: file.type, size: file.size, createdAt: new Date() });
  revalidatePath("/impostazioni");
  return Response.json({ id });
}
