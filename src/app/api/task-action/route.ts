import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { isAuthenticated } from "@/lib/auth";
import { db, ready } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { emit } from "@/lib/webhooks";

/** Pulsanti della notifica di promemoria (dal service worker): "done" completa, "snooze" riavvisa tra un'ora. */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) return Response.json({ error: "Non autorizzato" }, { status: 401 });
  await ready();
  const { id, action } = (await req.json().catch(() => ({}))) as { id?: string; action?: string };
  if (!id) return Response.json({ error: "Attività mancante" }, { status: 400 });
  if (action === "done") { await db.update(tasks).set({ done: true }).where(eq(tasks.id, id)); emit("task.completed", { id }); }
  else if (action === "snooze") await db.update(tasks).set({ remindAt: Date.now() + 3600000, reminded: false }).where(eq(tasks.id, id));
  else return Response.json({ error: "Azione sconosciuta" }, { status: 400 });
  revalidatePath("/", "layout");
  return Response.json({ ok: true });
}
