import { eq } from "drizzle-orm";
import { isAuthenticated } from "@/lib/auth";
import { db, ready } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { readStoredFile } from "@/lib/files";

/** Restituisce un allegato, solo dopo il login. ?download=1 lo scarica invece di aprirlo. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return new Response("Non autorizzato", { status: 401 });
  await ready();
  const [att] = await db.select().from(attachments).where(eq(attachments.id, (await params).id));
  if (!att) return new Response("Non trovato", { status: 404 });
  const data = await readStoredFile(att.id).catch(() => null);
  if (!data) return new Response("File mancante", { status: 404 });
  const disposition = new URL(req.url).searchParams.has("download") ? "attachment" : "inline";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": att.mime,
      "Content-Length": String(data.length),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(att.name)}`,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
