import { sqliteTable, text, integer, primaryKey, real, blob } from "drizzle-orm/sqlite-core";

/** Tipi di elemento in memoria (come nel design). */
export const ITEM_TYPES = ["Nota", "Idea", "Decisione", "Documento", "Riunione", "Pagina web", "Audio", "Attività"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** Forma catturata in Inbox. */
export type ItemKind = "note" | "link" | "file" | "audio";

/**
 * Ciclo di vita: inbox → processing → ready (proposta pronta) | error → memory (confermato) → archived.
 * Nulla entra in memoria senza conferma.
 */
export type ItemStatus = "processing" | "ready" | "error" | "memory" | "archived";

export type Proposal = {
  type: ItemType;
  title: string;
  topic: string;
  summary: string;
  people: string[];
  projectId: string | null;
  tags: string[];
  links: { id: string; conflict: boolean; reason: string }[];
  tasks: string[];
};

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  kind: text("kind").$type<ItemKind>().notNull(),
  status: text("status").$type<ItemStatus>().notNull(),
  type: text("type").$type<ItemType>(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  summary: text("summary"),
  source: text("source").notNull().default("Cattura rapida"),
  origin: text("origin").notNull().default("Inbox"),
  projectId: text("project_id"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  proposal: text("proposal", { mode: "json" }).$type<Proposal | null>(),
  error: text("error"),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").$type<"Attivo" | "In pausa" | "Chiuso">().notNull().default("Attivo"),
  description: text("description").notNull().default(""),
  next: text("next").notNull().default(""),
  pct: integer("pct").notNull().default(0),
});

export const people = sqliteTable("people", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  org: text("org").notNull().default(""),
  email: text("email").notNull().default(""),
  note: text("note").notNull().default(""),
});

export const itemPeople = sqliteTable(
  "item_people",
  {
    itemId: text("item_id").notNull(),
    personId: text("person_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.personId] })],
);

/** Collegamenti tra elementi: la base del grafo. */
export const links = sqliteTable(
  "links",
  {
    fromId: text("from_id").notNull(),
    toId: text("to_id").notNull(),
    kind: text("kind").$type<"related" | "conflict">().notNull().default("related"),
    reason: text("reason").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId] })],
);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  projectId: text("project_id"),
  prio: integer("prio").notNull().default(2),
  /** Data di scadenza ISO (YYYY-MM-DD) o null. */
  due: text("due"),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  /** Elemento da cui è nata l'attività. */
  sourceItemId: text("source_item_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /** Orario HH:MM (fuso Europe/Rome), facoltativo, insieme a due. */
  time: text("time"),
  /** Promemoria: minuti di anticipo rispetto a due+time; null = nessun promemoria. */
  remind: integer("remind"),
  /** Istante del promemoria (ms), calcolato da due, time e remind o spostato da "+1 ora". */
  remindAt: integer("remind_at"),
  reminded: integer("reminded", { mode: "boolean" }).notNull().default(false),
});

/** File allegati a un elemento (foto, PDF, audio). Il file sta in data/files/<id>. */
export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Impostazioni chiave/valore modificabili dall'app (hanno la precedenza sul .env). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Registro di ogni azione proposta o eseguita dall'IA. */
export const aiLog = sqliteTable("ai_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at", { mode: "timestamp_ms" }).notNull(),
  action: text("action").notNull(),
  itemId: text("item_id"),
  outcome: text("outcome").notNull(),
});

/** Conversazioni dell'Assistente, salvate sul server (messaggi in JSON, stesso formato del client). */
export const chats = sqliteTable("chats", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  scope: text("scope").notNull().default("all"),
  msgs: text("msgs").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Immagini di sfondo caricate dall'utente; il file sta in data/files/<id>. */
export const backgrounds = sqliteTable("backgrounds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Chiavi dell'API e del server MCP. Si salva solo l'hash SHA-256; `prefix` serve a riconoscerle. */
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull(),
  scope: text("scope").$type<"read" | "write">().notNull().default("read"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
});

/** Webhook in uscita: indirizzi avvisati con POST firmato quando succede un evento. */
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events", { mode: "json" }).$type<string[]>().notNull().default([]),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastStatus: text("last_status"),
  lastAt: integer("last_at", { mode: "timestamp_ms" }),
});

/** Obiettivi di un progetto, in ordine. */
export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  ord: integer("ord").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Dispositivi iscritti alle notifiche push (Web Push). */
export const pushSubs = sqliteTable("push_subs", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  device: text("device").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Consumo dell'IA per chiamata (costo in dollari, come lo restituisce OpenRouter). */
export const aiUsage = sqliteTable("ai_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at", { mode: "timestamp_ms" }).notNull(),
  task: text("task").notNull(),
  tier: text("tier").notNull(),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  cost: real("cost").notNull().default(0),
});

/** Impronta di significato di un elemento (vettore Float32 in un BLOB). */
export const embeddings = sqliteTable("embeddings", {
  itemId: text("item_id").primaryKey(),
  model: text("model").notNull(),
  hash: text("hash").notNull(),
  dims: integer("dims").notNull(),
  vec: blob("vec", { mode: "buffer" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Fatti stabili sull'utente, confermati da lui. */
export const facts = sqliteTable("facts", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  /** Da dove è arrivato: manuale, chat, comando, suggerimento. */
  source: text("source").notNull().default("manuale"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /** declared = detto dall'utente · inferred = dedotto dall'IA · observed = letto in un elemento. */
  origin: text("origin").$type<FactOrigin>().notNull().default("declared"),
  /** confirmed = valido e usato dall'IA · pending = da confermare · obsolete = non più vero (storia) · conflict = in contrasto. */
  status: text("status").$type<FactStatus>().notNull().default("confirmed"),
  /** Solo per i fatti dedotti: quanto è sicura l'IA (0-1). */
  confidence: real("confidence"),
  /** Id della conversazione o dell'elemento da cui nasce. */
  sourceRef: text("source_ref"),
  /** Periodo di validità (YYYY-MM-DD), null = non noto / ancora valido. */
  validFrom: text("valid_from"),
  validUntil: text("valid_until"),
  lastConfirmedAt: integer("last_confirmed_at", { mode: "timestamp_ms" }),
  /** Fatto che lo ha sostituito (es. il nuovo lavoro). */
  supersededBy: text("superseded_by"),
  /** Gruppo nel Memory Inspector; null = da classificare (lo fa l'IA all'apertura della pagina). */
  category: text("category").$type<FactCategory>(),
});
export const FACT_CATEGORIES = ["personale", "lavoro", "persone", "preferenze"] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];
export type FactOrigin = "declared" | "inferred" | "observed";
export type FactStatus = "confirmed" | "pending" | "obsolete" | "conflict";

/** Suggerimenti dell'IA mostrati nella Home. `actions` sono azioni di comando da confermare. */
export const insights = sqliteTable("insights", {
  id: text("id").primaryKey(),
  day: text("day").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  actions: text("actions", { mode: "json" }).$type<unknown[]>().notNull().default([]),
  refs: text("refs", { mode: "json" }).$type<{ id: string; title: string; href: string }[]>().notNull().default([]),
  status: text("status").$type<"new" | "done" | "dismissed">().notNull().default("new"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export type Item = typeof items.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
