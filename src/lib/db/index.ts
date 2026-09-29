import "server-only";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// Stesso codice in locale (file SQLite) e in produzione (Turso, raggiungibile da tutti i dispositivi).
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, type TEXT,
  title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', summary TEXT,
  source TEXT NOT NULL DEFAULT 'Cattura rapida', origin TEXT NOT NULL DEFAULT 'Inbox',
  project_id TEXT, tags TEXT NOT NULL DEFAULT '[]', proposal TEXT, error TEXT,
  favorite INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS items_status ON items(status);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Attivo',
  description TEXT NOT NULL DEFAULT '', next TEXT NOT NULL DEFAULT '', pct INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', org TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS item_people (item_id TEXT NOT NULL, person_id TEXT NOT NULL, PRIMARY KEY (item_id, person_id));
CREATE TABLE IF NOT EXISTS links (
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'related', reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, project_id TEXT, prio INTEGER NOT NULL DEFAULT 2, due TEXT,
  done INTEGER NOT NULL DEFAULT 0, source_item_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_item ON attachments(item_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
  ord INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS goals_project ON goals(project_id);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'all', msgs TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chats_updated ON chats(updated_at);
-- Ricerca a testo pieno sugli elementi (rowid = rowid di items), tenuta allineata dai trigger.
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(id UNINDEXED, title, summary, content, tags, tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS items_fts_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, id, title, summary, content, tags) VALUES (new.rowid, new.id, new.title, coalesce(new.summary, ''), new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_au AFTER UPDATE ON items BEGIN
  DELETE FROM items_fts WHERE rowid = old.rowid;
  INSERT INTO items_fts(rowid, id, title, summary, content, tags) VALUES (new.rowid, new.id, new.title, coalesce(new.summary, ''), new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_ad AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE rowid = old.rowid;
END;
CREATE TABLE IF NOT EXISTS backgrounds (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, scope TEXT NOT NULL DEFAULT 'read',
  created_at INTEGER NOT NULL, last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, last_status TEXT, last_at INTEGER
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, action TEXT NOT NULL, item_id TEXT, outcome TEXT NOT NULL
);
-- Consumo dell'IA: una riga per chiamata, con il costo restituito da OpenRouter (in dollari).
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, task TEXT NOT NULL, tier TEXT NOT NULL, model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ai_usage_at ON ai_usage(at);
-- Impronte di significato degli elementi (Float32 in un BLOB); hash del testo per sapere quando rifarle.
CREATE TABLE IF NOT EXISTS embeddings (
  item_id TEXT PRIMARY KEY, model TEXT NOT NULL, hash TEXT NOT NULL, dims INTEGER NOT NULL, vec BLOB NOT NULL, updated_at INTEGER NOT NULL
);
-- Fatti stabili sull'utente, confermati da lui: passati all'IA in ogni conversazione.
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manuale', created_at INTEGER NOT NULL,
  origin TEXT NOT NULL DEFAULT 'declared', status TEXT NOT NULL DEFAULT 'confirmed', confidence REAL, source_ref TEXT,
  valid_from TEXT, valid_until TEXT, last_confirmed_at INTEGER, superseded_by TEXT, category TEXT
);
-- Suggerimenti dell'IA (Home): azioni proposte da confermare, oppure da ignorare.
CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  actions TEXT NOT NULL DEFAULT '[]', refs TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'new', created_at INTEGER NOT NULL,
  why TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS insights_status ON insights(status);
-- Obiettivi personali (non di un progetto) e gli elementi collegati; le attività li indicano con tasks.aim_id.
CREATE TABLE IF NOT EXISTS aims (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
  due TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, done_at INTEGER
);
CREATE TABLE IF NOT EXISTS aim_items (aim_id TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY (aim_id, item_id));
`;

const g = globalThis as unknown as { __sbClient?: Client; __sbReady?: Promise<void> };

function client() {
  if (!g.__sbClient) {
    g.__sbClient = createClient({
      url: process.env.DATABASE_URL ?? "file:data/second-brain.db",
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    });
  }
  return g.__sbClient;
}

export const db = drizzle(client(), { schema });

const FTS_VERSION = "1";

// Colonne aggiunte dopo la prima versione: si aggiungono ai database esistenti, l'errore "duplicate column" si ignora.
const ADD_COLUMNS = [
  "ALTER TABLE tasks ADD COLUMN time TEXT",
  "ALTER TABLE tasks ADD COLUMN remind INTEGER",
  "ALTER TABLE tasks ADD COLUMN remind_at INTEGER",
  "ALTER TABLE tasks ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0",
  // Fatti con provenienza, stato e validità (28/9): quelli già presenti restano «detti dall'utente, confermati».
  "ALTER TABLE facts ADD COLUMN origin TEXT NOT NULL DEFAULT 'declared'",
  "ALTER TABLE facts ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'",
  "ALTER TABLE facts ADD COLUMN confidence REAL",
  "ALTER TABLE facts ADD COLUMN source_ref TEXT",
  "ALTER TABLE facts ADD COLUMN valid_from TEXT",
  "ALTER TABLE facts ADD COLUMN valid_until TEXT",
  "ALTER TABLE facts ADD COLUMN last_confirmed_at INTEGER",
  "ALTER TABLE facts ADD COLUMN superseded_by TEXT",
  "UPDATE facts SET last_confirmed_at = created_at WHERE last_confirmed_at IS NULL",
  "ALTER TABLE facts ADD COLUMN category TEXT",
  "ALTER TABLE insights ADD COLUMN why TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE tasks ADD COLUMN aim_id TEXT",
];

/** Crea le tabelle al primo accesso e aggiunge le colonne mancanti. */
export function ready() {
  if (!g.__sbReady) {
    g.__sbReady = (async () => {
      await client().executeMultiple(SCHEMA_SQL);
      for (const q of ADD_COLUMNS) await client().execute(q).catch(() => {});
      // Indice di ricerca: riempito una volta per gli elementi già presenti, poi lo aggiornano i trigger.
      const v = await client().execute("SELECT value FROM settings WHERE key = 'fts_version'");
      if (v.rows[0]?.value !== FTS_VERSION) {
        await client().batch([
          "DELETE FROM items_fts",
          "INSERT INTO items_fts(rowid, id, title, summary, content, tags) SELECT rowid, id, title, coalesce(summary, ''), content, tags FROM items",
          { sql: "INSERT INTO settings(key, value) VALUES ('fts_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [FTS_VERSION] },
        ], "write");
      }
    })();
  }
  return g.__sbReady;
}

export function newId(prefix: string) {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
