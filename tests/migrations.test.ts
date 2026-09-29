// Migrazioni: un database creato con le prime versioni si aggiorna all'avvio (tabelle e colonne nuove) senza perdere dati.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sb-test-")), "old.db");
process.env.DATABASE_URL = "file:" + file;

test("un database vecchio si aggiorna senza perdere dati", async () => {
  // Schema della prima versione (senza promemoria, obiettivi personali, provenienza dei fatti…).
  const old = createClient({ url: "file:" + file });
  await old.executeMultiple(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, project_id TEXT, prio INTEGER NOT NULL DEFAULT 2, due TEXT, done INTEGER NOT NULL DEFAULT 0, source_item_id TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE facts (id TEXT PRIMARY KEY, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manuale', created_at INTEGER NOT NULL);
    CREATE TABLE insights (id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', actions TEXT NOT NULL DEFAULT '[]', refs TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'new', created_at INTEGER NOT NULL);
    INSERT INTO tasks (id, title, created_at) VALUES ('ta_1', 'Vecchia attività', 1700000000000);
    INSERT INTO facts (id, text, created_at) VALUES ('fa_1', 'Vecchio fatto', 1700000000000);
  `);
  old.close();

  const { ready } = await import("../src/lib/db");
  await ready();

  const c = createClient({ url: "file:" + file });
  const cols = async (t: string) => (await c.execute(`PRAGMA table_info(${t})`)).rows.map((r) => String(r.name));
  assert.ok((await cols("tasks")).includes("aim_id"), "tasks.aim_id");
  assert.ok((await cols("tasks")).includes("remind_at"), "tasks.remind_at");
  for (const k of ["origin", "status", "valid_from", "valid_until", "last_confirmed_at", "superseded_by", "category"]) assert.ok((await cols("facts")).includes(k), "facts." + k);
  assert.ok((await cols("insights")).includes("why"), "insights.why");
  for (const t of ["aims", "aim_items", "checkins", "embeddings", "chats"]) {
    assert.equal((await c.execute({ sql: "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", args: [t] })).rows[0].n, 1, "tabella " + t);
  }
  // I dati di prima restano, con i valori predefiniti giusti.
  const f = (await c.execute("SELECT text, origin, status, last_confirmed_at FROM facts WHERE id = 'fa_1'")).rows[0];
  assert.equal(f.text, "Vecchio fatto");
  assert.equal(f.origin, "declared");
  assert.equal(f.status, "confirmed");
  assert.equal(Number(f.last_confirmed_at), 1700000000000);
  assert.equal((await c.execute("SELECT title FROM tasks WHERE id = 'ta_1'")).rows[0].title, "Vecchia attività");
  c.close();
});
