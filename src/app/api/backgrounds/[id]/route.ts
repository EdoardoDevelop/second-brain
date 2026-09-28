import { eq } from "drizzle-orm";
import { isAuthenticated } from "@/lib/auth";
import { db, ready } from "@/lib/db";
import { backgrounds } from "@/lib/db/schema";
import { readStoredFile } from "@/lib/files";

/** Immagine di sfondo caricata. L'id non cambia mai, quindi il browser può tenerla in cache a lungo. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return new Response("Non autorizzato", { status: 401 });
  await ready();
  const { id } = await params;
  const [row] = await db.select().from(backgrounds).where(eq(backgrounds.id, id));
  if (!row) return new Response("Non trovato", { status: 404 });
  const data = await readStoredFile(id).catch(() => null);
  if (!data) return new Response("Non trovato", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { "Content-Type": row.mime, "Cache-Control": "private, max-age=31536000, immutable" } });
}
