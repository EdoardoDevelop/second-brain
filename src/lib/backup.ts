import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { FILES_DIR } from "./files";
import { isoDay } from "./format";
import { getSetting, setSetting } from "./settings";

/**
 * Backup automatico, ogni notte (e su richiesta dalle Impostazioni):
 * - copia coerente del database con `VACUUM INTO` (anche mentre l'app lavora) in data/backups/second-brain-AAAA-MM-GG.db;
 * - allegati copiati in data/backups/files/ solo se mancano (non cambiano mai: il nome è l'id);
 * - rotazione: le copie degli ultimi 14 giorni, poi una a settimana (il lunedì) per 8 settimane.
 * È sullo stesso disco: protegge da errori e cancellazioni, non da un guasto del server. Per una copia fuori dal
 * server c'è «Scarica l'ultimo backup» nelle Impostazioni (/api/backup).
 * Ripristino: fermare il servizio, copiare il file al posto di data/second-brain.db, riavviare.
 */

export const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(process.cwd(), "data", "backups");
const NAME = /^second-brain-(\d{4}-\d{2}-\d{2})\.db$/;
const KEEP_DAILY = 14;
const KEEP_WEEKLY = 8;

export type BackupStatus = { at: number; file: string | null; size: number; files: number; kept: number; error: string | null };

/** Solo per un database su file (in produzione e in locale); con un database remoto (Turso) non serve. */
function dbFile(): string | null {
  const url = process.env.DATABASE_URL ?? "file:data/second-brain.db";
  return url.startsWith("file:") ? path.resolve(url.slice(5)) : null;
}

export async function listBackups(): Promise<{ name: string; day: string; size: number }[]> {
  const names = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const out: { name: string; day: string; size: number }[] = [];
  for (const n of names) {
    const m = n.match(NAME);
    if (!m) continue;
    const st = await fs.stat(path.join(BACKUP_DIR, n)).catch(() => null);
    if (st) out.push({ name: n, day: m[1], size: st.size });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

/** Tiene gli ultimi 14 giorni e, prima, un lunedì a settimana per 8 settimane. */
async function rotate(today: string) {
  const all = await listBackups();
  const DAY = 86400000;
  const age = (d: string) => Math.round((Date.parse(today) - Date.parse(d)) / DAY);
  for (const b of all) {
    const a = age(b.day);
    const keep = a < KEEP_DAILY || (a < KEEP_WEEKLY * 7 + KEEP_DAILY && new Date(b.day + "T12:00:00Z").getUTCDay() === 1);
    if (!keep) await fs.rm(path.join(BACKUP_DIR, b.name), { force: true });
  }
  return (await listBackups()).length;
}

/** Copia degli allegati che mancano nel backup (i file non cambiano mai). */
async function mirrorFiles(): Promise<number> {
  const src = await fs.readdir(FILES_DIR).catch(() => [] as string[]);
  if (!src.length) return 0;
  const dest = path.join(BACKUP_DIR, "files");
  await fs.mkdir(dest, { recursive: true });
  const have = new Set(await fs.readdir(dest).catch(() => [] as string[]));
  let n = 0;
  for (const f of src) {
    if (have.has(f)) continue;
    await fs.copyFile(path.join(FILES_DIR, f), path.join(dest, f)).then(() => n++).catch(() => {});
  }
  return n;
}

export async function runBackup(): Promise<BackupStatus> {
  const status: BackupStatus = { at: Date.now(), file: null, size: 0, files: 0, kept: 0, error: null };
  try {
    if (!dbFile()) throw new Error("Il database non è un file locale: backup non necessario.");
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const day = isoDay();
    const name = `second-brain-${day}.db`;
    const target = path.join(BACKUP_DIR, name);
    // VACUUM INTO non sovrascrive: la copia di oggi si rifà da zero.
    await fs.rm(target, { force: true });
    await db.run(sql.raw(`VACUUM INTO '${target.replace(/'/g, "''")}'`));
    status.file = name;
    status.size = (await fs.stat(target)).size;
    status.files = await mirrorFiles();
    status.kept = await rotate(day);
  } catch (e) {
    status.error = e instanceof Error ? e.message : "Errore";
  }
  await setSetting("backup_status", JSON.stringify(status)).catch(() => {});
  return status;
}

export async function backupStatus(): Promise<BackupStatus | null> {
  try { return JSON.parse((await getSetting("backup_status")) ?? "null"); } catch { return null; }
}

/** Dal pianificatore (ogni minuto): una volta per notte, dopo le 2:30 (ora italiana). */
export async function backupTick() {
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const today = isoDay();
  if (now < "02:30" || (await getSetting("backup_last")) === today) return;
  await setSetting("backup_last", today);
  const s = await runBackup();
  if (s.error) console.error("[backup]", s.error);
}
