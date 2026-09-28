import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { isAuthenticated } from "@/lib/auth";
import { db, ready } from "@/lib/db";
import { items } from "@/lib/db/schema";
import { captureUpload } from "@/lib/capture";

// La lettura di un PDF o di un audio lungo può richiedere più di un minuto.
export const maxDuration = 300;

/** Cattura di un file (foto, PDF, audio) in Inbox. Multipart: `file` e, facoltativa, `note`. */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) return Response.json({ error: "Non autorizzato" }, { status: 401 });
  await ready();
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Nessun file." }, { status: 400 });
  const res = await captureUpload(file, String(form?.get("note") ?? "").trim());
  if ("error" in res) return Response.json({ error: res.error }, { status: res.status });
  revalidatePath("/", "layout");
  const [row] = await db.select().from(items).where(eq(items.id, res.id));
  return Response.json(row);
}
