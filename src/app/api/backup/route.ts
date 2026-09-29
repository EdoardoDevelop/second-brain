import fs from "node:fs/promises";
import path from "node:path";
import { isAuthenticated } from "@/lib/auth";
import { BACKUP_DIR, listBackups } from "@/lib/backup";

/** Scarica una copia del database (l'ultima, o ?day=AAAA-MM-GG): per tenerne una fuori dal server. */
export async function GET(req: Request) {
  if (!(await isAuthenticated())) return new Response("Non autorizzato", { status: 401 });
  const day = new URL(req.url).searchParams.get("day");
  const list = await listBackups();
  const b = day ? list.find((x) => x.day === day) : list[0];
  if (!b) return new Response("Nessun backup ancora: usa «Fai un backup ora».", { status: 404 });
  const data = await fs.readFile(path.join(BACKUP_DIR, b.name));
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "application/vnd.sqlite3", "Content-Disposition": `attachment; filename="${b.name}"`, "Content-Length": String(data.length), "Cache-Control": "no-store" },
  });
}
