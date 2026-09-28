"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, newId, ready } from "./db";
import { aiLog, aiUsage, apiKeys, attachments, backgrounds, chats, embeddings, facts, goals, insights, itemPeople, items, links, people, projects, pushSubs, tasks, webhooks, type ItemKind, type Proposal } from "./db/schema";
import { aiEnabled, classify, contextNames, quickCommand, transcribe, manualProposal, runItemAction, type AiActionKind, type AiActionResult, type CommandAction, type CommandContext, type CommandResult } from "./ai";
import { endSession, requireAuth } from "./auth";
import { commandContext, memoryContext } from "./queries";
import { isoDay, reminderFields } from "./format";
import { getAiConfig, getProfile, getSetting, isOpenRouterKey, setSetting, type AiModels, type AiPrivacy } from "./settings";
import { writeBrief } from "./ai";
import { briefData } from "./queries";
import { runAgent } from "./agent";
import { budgetState, EUR_PER_USD, resetUnavailable } from "./llm";
import { syncEmbeddings } from "./semantic";
import { gardenMemory, type GardenStatus } from "./garden";
import { generateInsights, morningBrief } from "./proactive";
import { parseLook, type Look } from "./theme";
import { FILE_ERROR, log, processAttachment, propose, reindexSoon } from "./pipeline";
import { removeFiles } from "./files";
import { executeActions } from "./commands";
import { deliver, emit, WEBHOOK_EVENTS } from "./webhooks";
import { createApiKey } from "./api-keys";
import { randomBytes } from "node:crypto";
import type { ChatMsg, ChatSummary } from "./chat";
import { parseHome, type HomeLayout } from "./home";
import { parseWeatherConfig, type Place, type WeatherConfig } from "./weather";
import { searchPlaces } from "./weather-api";
import { parseNewsConfig, type Article, type NewsConfig } from "./news";
import { getNewsFeed } from "./news-api";
import { captureText } from "./capture";
import { parseProfile, type Profile } from "./profile";
import { DEFAULT_PREFS, sendPush, vapidPublicKey, type NotifyPrefs } from "./push";
import demo from "./demo-data.json";

// ——— accesso ———

export async function logout() {
  await endSession();
  redirect("/login");
}

// ——— helper ———

async function guard() {
  await requireAuth();
  await ready();
}

function refreshAll() {
  revalidatePath("/", "layout");
}

/** Elimina gli allegati (righe e file); senza condizione, tutti. */
async function removeAttachments(where?: SQL) {
  const rows = await db.select({ id: attachments.id }).from(attachments).where(where);
  await db.delete(attachments).where(where);
  await removeFiles(rows.map((r) => r.id));
}

// ——— Inbox ———

export async function capture(input: { text: string; kind: ItemKind; source?: string }) {
  await guard();
  const text = input.text.trim();
  if (!text) return null;
  const id = newId("it");
  const now = new Date();
  const firstLine = text.split("\n")[0];
  await db.insert(items).values({
    id, kind: input.kind, status: "processing", title: firstLine.slice(0, 120), content: text,
    source: input.source ?? "Cattura rapida", origin: input.kind === "link" ? "Link" : "Inbox",
    createdAt: now, updatedAt: now,
  });
  await propose(id, text);
  refreshAll();
  const [row] = await db.select().from(items).where(eq(items.id, id));
  return row ?? null;
}

export async function retry(id: string) {
  await guard();
  const [row] = await db.select().from(items).where(eq(items.id, id));
  if (!row) return;
  await db.update(items).set({ status: "processing", error: null }).where(eq(items.id, id));
  // Se non era riuscita la lettura dell'allegato, si rilegge il file; altrimenti si ripete solo la classificazione.
  if (row.error?.startsWith(FILE_ERROR)) await processAttachment(id, row.content.startsWith("File allegato: ") ? "" : row.content);
  else await propose(id, row.content);
  refreshAll();
}

async function findOrCreatePerson(name: string) {
  const clean = name.trim();
  const [found] = await db.select().from(people).where(sql`lower(${people.name}) = lower(${clean})`);
  if (found) return found.id;
  // Corrispondenza sul solo nome di battesimo ("Marco" → "Marco Rinaldi").
  const [byFirst] = await db.select().from(people).where(sql`lower(${people.name}) like lower(${clean + " %"})`);
  if (byFirst) return byFirst.id;
  const id = newId("pe");
  await db.insert(people).values({ id, name: clean });
  return id;
}

export async function confirm(id: string, p: Proposal) {
  await guard();
  const now = new Date();
  await db.update(items).set({
    status: "memory", type: p.type, title: p.title.trim() || "Senza titolo", summary: p.summary || null,
    projectId: p.projectId, tags: p.tags, proposal: null, confirmedAt: now, updatedAt: now,
  }).where(eq(items.id, id));
  const me = (await getProfile()).name.trim().toLowerCase();
  for (const name of p.people) {
    if (!name.trim()) continue;
    // L'utente stesso non va tra le persone: il suo nome completo o il solo nome di battesimo.
    const n = name.trim().toLowerCase();
    if (me && (n === me || n === me.split(/\s+/)[0])) continue;
    await db.insert(itemPeople).values({ itemId: id, personId: await findOrCreatePerson(name) }).onConflictDoNothing();
  }
  for (const l of p.links) {
    await db.insert(links).values({ fromId: id, toId: l.id, kind: l.conflict ? "conflict" : "related", reason: l.reason }).onConflictDoNothing();
  }
  const taskTitles = p.type === "Attività" && p.tasks.length === 0 ? [p.title] : p.tasks;
  for (const title of taskTitles) {
    await db.insert(tasks).values({ id: newId("ta"), title, projectId: p.projectId, prio: 2, sourceItemId: id, createdAt: now });
  }
  await log("Classificazione", id, "Confermata" + (taskTitles.length ? ` · ${taskTitles.length} attività create` : ""));
  emit("item.confirmed", { id, type: p.type, title: p.title, tags: p.tags, projectId: p.projectId, people: p.people, tasks: taskTitles });
  refreshAll();
  reindexSoon();
}

export async function saveRaw(id: string) {
  await guard();
  const now = new Date();
  await db.update(items).set({ status: "memory", type: "Nota", proposal: null, confirmedAt: now, updatedAt: now }).where(eq(items.id, id));
  await log("Classificazione", id, "Ignorata · salvato senza classificazione");
  refreshAll();
}

export async function discard(id: string) {
  await guard();
  await removeAttachments(eq(attachments.itemId, id));
  await db.delete(items).where(eq(items.id, id));
  refreshAll();
}

export async function archive(id: string) {
  await guard();
  await db.update(items).set({ status: "archived", updatedAt: new Date() }).where(eq(items.id, id));
  refreshAll();
}

// ——— Conoscenza ———

export async function toggleFavorite(id: string) {
  await guard();
  await db.update(items).set({ favorite: sql`not ${items.favorite}` }).where(eq(items.id, id));
  refreshAll();
}

export async function deleteItem(id: string) {
  await guard();
  await removeAttachments(eq(attachments.itemId, id));
  await db.delete(items).where(eq(items.id, id));
  await db.delete(itemPeople).where(eq(itemPeople.itemId, id));
  await db.delete(links).where(or(eq(links.fromId, id), eq(links.toId, id)));
  refreshAll();
  redirect("/conoscenza");
}

export async function updateContent(id: string, content: string) {
  await guard();
  await db.update(items).set({ content, updatedAt: new Date() }).where(eq(items.id, id));
  refreshAll();
}

export type ItemMetaInput = { title: string; type: Proposal["type"]; summary: string; tags: string[]; projectId: string | null; personIds: string[] };

/** Modifica i dati di un elemento già in memoria (titolo, tipo, sintesi, tag, progetto, persone). */
export async function updateItemMeta(id: string, m: ItemMetaInput) {
  await guard();
  const tags = [...new Set(m.tags.map((t) => t.trim().replace(/^#/, "")).filter(Boolean))];
  await db.update(items).set({
    title: m.title.trim() || "Senza titolo", type: m.type, summary: m.summary.trim() || null, tags,
    projectId: m.projectId || null, updatedAt: new Date(),
  }).where(eq(items.id, id));
  await db.delete(itemPeople).where(eq(itemPeople.itemId, id));
  for (const personId of new Set(m.personIds)) await db.insert(itemPeople).values({ itemId: id, personId });
  refreshAll();
}

export async function itemAiAction(id: string, kind: AiActionKind): Promise<AiActionResult | { error: string }> {
  await guard();
  if (!(await aiEnabled())) return { error: "Imposta OPENROUTER_API_KEY per usare le azioni IA." };
  const [row] = await db.select().from(items).where(eq(items.id, id));
  if (!row) return { error: "Elemento non trovato." };
  const linkRows = await db.select().from(links).where(or(eq(links.fromId, id), eq(links.toId, id)));
  const otherIds = linkRows.map((l) => (l.fromId === id ? l.toId : l.fromId));
  const related = otherIds.length ? await db.select({ title: items.title, summary: items.summary }).from(items).where(inArray(items.id, otherIds)) : [];
  try {
    const res = await runItemAction(kind, row, related.map((r) => `${r.title}: ${r.summary ?? ""}`));
    await log(res.title, id, "Proposta");
    return res;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Errore dell'IA." };
  }
}

export async function acceptAiAction(id: string, kind: AiActionKind, res: AiActionResult) {
  await guard();
  const [row] = await db.select().from(items).where(eq(items.id, id));
  if (!row) return;
  const now = new Date();
  if (kind === "summarize") {
    await db.update(items).set({ summary: res.paragraphs.join(" "), updatedAt: now }).where(eq(items.id, id));
  } else if (kind === "explain") {
    await db.update(items).set({ content: row.content + "\n\n" + res.paragraphs.join("\n\n"), updatedAt: now }).where(eq(items.id, id));
  } else {
    for (const title of res.list) {
      await db.insert(tasks).values({ id: newId("ta"), title, projectId: row.projectId, prio: 2, sourceItemId: id, createdAt: now });
    }
  }
  await log(res.title, id, "Confermata da te");
  refreshAll();
}

// ——— Attività ———

export async function addTask(title: string) {
  await guard();
  if (!title.trim()) return;
  await db.insert(tasks).values({ id: newId("ta"), title: title.trim(), prio: 2, createdAt: new Date() });
  refreshAll();
}

export async function toggleTask(id: string) {
  await guard();
  await db.update(tasks).set({ done: sql`not ${tasks.done}` }).where(eq(tasks.id, id));
  const [t] = await db.select({ done: tasks.done, title: tasks.title }).from(tasks).where(eq(tasks.id, id));
  if (t?.done) emit("task.completed", { id, title: t.title });
  refreshAll();
}

export async function setTaskDue(id: string, due: string | null) {
  await guard();
  const [cur] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!cur) return;
  await db.update(tasks).set({ due, ...reminderFields(due, cur.time, cur.remind) }).where(eq(tasks.id, id));
  refreshAll();
}

export type TaskInput = { title: string; projectId: string | null; prio: number; due: string | null; time?: string | null; remind?: number | null };

export async function updateTask(id: string, t: TaskInput) {
  await guard();
  if (!t.title.trim()) return;
  const due = t.due && /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : null;
  await db.update(tasks).set({
    title: t.title.trim(), projectId: t.projectId || null, prio: Math.max(1, Math.min(3, Math.round(t.prio) || 2)), due,
    ...reminderFields(due, t.time ?? null, t.remind ?? null),
  }).where(eq(tasks.id, id));
  refreshAll();
}

export async function deleteTask(id: string) {
  await guard();
  await db.delete(tasks).where(eq(tasks.id, id));
  refreshAll();
}

// ——— Progetti ———

export type ProjectInput = { name: string; status: "Attivo" | "In pausa" | "Chiuso"; description: string; next: string; pct: number };

export async function saveProject(id: string | null, p: ProjectInput) {
  await guard();
  const values = { ...p, name: p.name.trim() || "Senza nome", pct: Math.max(0, Math.min(100, Math.round(p.pct) || 0)) };
  if (id) await db.update(projects).set(values).where(eq(projects.id, id));
  else await db.insert(projects).values({ id: (id = newId("pr")), ...values });
  refreshAll();
  return id;
}

/** Elimina il progetto; elementi e attività restano, senza progetto. */
export async function deleteProject(id: string) {
  await guard();
  await db.update(items).set({ projectId: null }).where(eq(items.projectId, id));
  await db.update(tasks).set({ projectId: null }).where(eq(tasks.projectId, id));
  await db.delete(goals).where(eq(goals.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
  await setSetting(`brief:project:${id}`, null);
  refreshAll();
  redirect("/progetti");
}

export async function addProjectTask(projectId: string, title: string) {
  await guard();
  if (!title.trim()) return;
  await db.insert(tasks).values({ id: newId("ta"), title: title.trim(), projectId, prio: 2, createdAt: new Date() });
  refreshAll();
}

// ——— Obiettivi del progetto ———

export async function addGoal(projectId: string, title: string) {
  await guard();
  if (!title.trim()) return;
  const [last] = await db.select({ ord: goals.ord }).from(goals).where(eq(goals.projectId, projectId)).orderBy(sql`${goals.ord} desc`).limit(1);
  await db.insert(goals).values({ id: newId("go"), projectId, title: title.trim(), ord: (last?.ord ?? -1) + 1, createdAt: new Date() });
  refreshAll();
}

export async function toggleGoal(id: string) {
  await guard();
  await db.update(goals).set({ done: sql`not ${goals.done}` }).where(eq(goals.id, id));
  refreshAll();
}

export async function renameGoal(id: string, title: string) {
  await guard();
  if (!title.trim()) return;
  await db.update(goals).set({ title: title.trim() }).where(eq(goals.id, id));
  refreshAll();
}

export async function deleteGoal(id: string) {
  await guard();
  await db.delete(goals).where(eq(goals.id, id));
  refreshAll();
}

/** Sposta un obiettivo di una posizione (su = -1, giù = +1) scambiandolo con il vicino. */
export async function moveGoal(id: string, dir: -1 | 1) {
  await guard();
  const [g] = await db.select().from(goals).where(eq(goals.id, id));
  if (!g) return;
  const list = await db.select().from(goals).where(eq(goals.projectId, g.projectId)).orderBy(goals.ord, goals.createdAt);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
  for (const [ord, x] of list.entries()) if (x.ord !== ord) await db.update(goals).set({ ord }).where(eq(goals.id, x.id));
  refreshAll();
}

// ——— Persone ———

export type PersonInput = { name: string; role: string; org: string; email: string; note: string };

export async function savePerson(id: string | null, p: PersonInput) {
  await guard();
  const values = { ...p, name: p.name.trim() || "Senza nome" };
  if (id) await db.update(people).set(values).where(eq(people.id, id));
  else await db.insert(people).values({ id: (id = newId("pe")), ...values });
  refreshAll();
  return id;
}

/** Elimina la persona e i suoi collegamenti agli elementi (gli elementi restano). */
export async function deletePerson(id: string) {
  await guard();
  await db.delete(itemPeople).where(eq(itemPeople.personId, id));
  await db.delete(people).where(eq(people.id, id));
  await setSetting(`brief:person:${id}`, null);
  refreshAll();
  redirect("/persone");
}

// ——— Sintesi IA di progetto e persona ———

export type SavedBrief = { paragraphs: string[]; points: string[]; at: number; count: number };

/** Genera e salva la sintesi. È un riassunto di ciò che è già in memoria: non aggiunge né modifica elementi. */
export async function generateBrief(kind: "project" | "person", id: string): Promise<SavedBrief | { error: string }> {
  await guard();
  if (!(await aiEnabled())) return { error: "Imposta la chiave OpenRouter nelle Impostazioni." };
  const src = await briefData(kind, id);
  if (!src) return { error: kind === "project" ? "Progetto non trovato." : "Persona non trovata." };
  try {
    const b = await writeBrief(kind, src.data);
    const saved: SavedBrief = { paragraphs: b.paragraphs, points: b.points, at: Date.now(), count: src.count };
    await setSetting(`brief:${kind}:${id}`, JSON.stringify(saved));
    await log(kind === "project" ? "Cosa dovresti sapere" : "Relazione in breve", null, "Generata");
    refreshAll();
    return saved;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Errore dell'IA." };
  }
}

// ——— Comandi (voce o testo) ———

/** Nomi leggibili degli id citati nelle schede di conferma. */
function commandNames(ctx: CommandContext): Record<string, string> {
  return Object.fromEntries([
    ...[...ctx.projects, ...ctx.people].map((x) => [x.id, x.name]),
    ...[...ctx.tasks, ...ctx.items, ...ctx.goals].map((x) => [x.id, x.title]),
  ]);
}

/**
 * Interpreta un comando (barra ⌘J): l'Assistente a passi cerca quello che serve e propone le azioni.
 * Nessuna scrittura, solo proposte da confermare. Audio in base64 (WAV): prima si trascrive.
 * Se è una domanda, `reply` contiene la risposta.
 */
export async function interpret(input: { text?: string; audio?: string }): Promise<(CommandResult & { names: Record<string, string>; reply: string }) | { error: string }> {
  await guard();
  if (!(await aiEnabled())) return { error: "Imposta la chiave OpenRouter nelle Impostazioni per usare i comandi." };
  if (!input.text?.trim() && !input.audio) return { error: "Niente da interpretare." };
  try {
    const t0 = Date.now();
    const text = input.audio ? await transcribe(input.audio) : input.text!.trim();
    if (!text) return { error: "Non ho sentito nulla. Riprova." };
    const t1 = Date.now();
    const sec = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
    const heard = input.audio ? `trascrizione ${sec(t1 - t0)} · ` : "";
    // Prima la via veloce: un solo passaggio con il modello rapido e il contesto già pronto.
    const ctx = await commandContext();
    const quick = await quickCommand(text, ctx).catch(() => null);
    if (quick && !quick.question && quick.actions.length) {
      await log(input.audio ? "Comando vocale" : "Comando scritto", null, `${heard}comando ${sec(Date.now() - t1)} · proposte ${quick.actions.length} azioni · via veloce`);
      return { transcript: text, actions: quick.actions, names: contextNames(ctx), reply: "" };
    }
    // Domande (o comandi non capiti): l'Assistente a passi cerca nella memoria.
    const r = await runAgent({ question: text, mode: "command" });
    await log(input.audio ? "Comando vocale" : "Comando scritto", null, `${heard}assistente ${sec(Date.now() - t1)} · ${r.steps.length} passi · proposte ${r.actions.length} azioni · ${r.model}`);
    return { transcript: text, actions: r.actions, names: r.names, reply: r.actions.length ? "" : r.text.replace(/⟦[^⟧]*⟧/g, "").replace(/ +([.,;:])/g, "$1").trim() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Errore dell'IA." };
  }
}

/** Esegue le azioni confermate dall'utente. */
export async function runCommand(actions: CommandAction[]) {
  await guard();
  const n = await executeActions(actions, "web");
  refreshAll();
  return n;
}


// ——— Assistente ———

/** «Salva in memoria» una risposta dell'Assistente: va in Inbox come nota, da confermare come ogni cattura. */
export async function saveAnswer(question: string, text: string, sources: { title: string }[]) {
  await guard();
  const body = [text.replace(/⟦[^⟧]*⟧/g, "").replace(/ +([.,;:])/g, "$1").trim(), sources.length ? `Fonti: ${sources.map((s) => s.title).join("; ")}` : ""].filter(Boolean).join("\n\n");
  const id = await captureText(`${question}\n\n${body}`, { kind: "note", source: "Assistente", origin: "Assistente", title: question.slice(0, 100), wait: false });
  await log("Risposta salvata in Inbox", id, "Da confermare");
  refreshAll();
  return id;
}

// ——— Suggerimenti e riepilogo del mattino (IA che prende l'iniziativa) ———

/** Esegue le azioni scelte di un suggerimento (confermate dall'utente) e lo segna come fatto. */
export async function completeInsight(id: string, actions: CommandAction[]) {
  await guard();
  const n = actions.length ? await executeActions(actions, "web") : 0;
  await db.update(insights).set({ status: "done" }).where(eq(insights.id, id));
  await log("Suggerimento accettato", null, `${n} azioni eseguite`);
  refreshAll();
  return n;
}

export async function dismissInsight(id: string) {
  await guard();
  await db.update(insights).set({ status: "dismissed" }).where(eq(insights.id, id));
  refreshAll();
}

/** Rigenera subito riepilogo e suggerimenti (pulsante nella Home). */
export async function runMorningRound(): Promise<{ ok: true } | { error: string }> {
  await guard();
  if (!(await aiEnabled())) return { error: "Imposta la chiave OpenRouter nelle Impostazioni." };
  const b = await budgetState();
  if (b.over) return { error: "Tetto di spesa del mese raggiunto: i suggerimenti ripartono il mese prossimo (o alza il tetto nelle Impostazioni)." };
  // Riepilogo e suggerimenti sono indipendenti: se uno fallisce, l'altro resta.
  const errors: string[] = [];
  await morningBrief().catch((e) => errors.push("riepilogo: " + (e instanceof Error ? e.message : "errore")));
  await generateInsights().catch((e) => errors.push("suggerimenti: " + (e instanceof Error ? e.message : "errore")));
  refreshAll();
  return errors.length ? { error: `Non riuscito (${errors.join("; ")}).` } : { ok: true };
}

// ——— Fatti su di te (memoria dell'IA) ———

export type Fact = { id: string; text: string; source: string; createdAt: number };

export async function listFacts(): Promise<Fact[]> {
  await guard();
  const rows = await db.select().from(facts).orderBy(sql`${facts.createdAt} desc`);
  return rows.map((f) => ({ id: f.id, text: f.text, source: f.source, createdAt: f.createdAt.getTime() }));
}

/** Aggiunge un fatto (confermato dall'utente: dalla chat, da un suggerimento o scritto a mano). */
export async function addFact(text: string, source = "manuale") {
  await guard();
  const t = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!t) return;
  const dup = (await db.select({ text: facts.text }).from(facts)).some((f) => f.text.toLowerCase() === t.toLowerCase());
  if (!dup) await db.insert(facts).values({ id: newId("fa"), text: t, source, createdAt: new Date() });
  await log("Fatto ricordato", null, t);
  refreshAll();
}

export async function updateFact(id: string, text: string) {
  await guard();
  const t = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (t) await db.update(facts).set({ text: t }).where(eq(facts.id, id));
  else await db.delete(facts).where(eq(facts.id, id));
  refreshAll();
}

export async function deleteFact(id: string) {
  await guard();
  await db.delete(facts).where(eq(facts.id, id));
  refreshAll();
}

export async function transcribeAudio(wav: string): Promise<{ text: string } | { error: string }> {
  await guard();
  if (!(await aiEnabled())) return { error: "Imposta la chiave OpenRouter nelle Impostazioni." };
  try {
    const text = await transcribe(wav);
    return text ? { text } : { error: "Non ho sentito nulla. Riprova." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Errore di trascrizione." };
  }
}

// ——— Conversazioni dell'Assistente ———

/** Salva (o crea) una conversazione. I messaggi hanno lo stesso formato del client; le azioni in corso diventano annullate. */
export async function saveChat(id: string | null, scope: string, msgs: ChatMsg[]): Promise<string> {
  await guard();
  const clean = msgs
    .filter((m) => m.role !== "assistant" || !m.streaming)
    .map((m) => (m.role === "assistant" && m.cmd === "saving" ? { ...m, cmd: "discarded" as const } : m));
  const first = clean.find((m) => m.role === "user");
  const title = first && "text" in first ? first.text.replace(/\s+/g, " ").slice(0, 80) : "Nuova conversazione";
  const now = new Date();
  if (id) {
    const res = await db.update(chats).set({ scope, msgs: JSON.stringify(clean), title, updatedAt: now }).where(eq(chats.id, id));
    if (res.rowsAffected) return id;
  }
  const newIdValue = newId("ch");
  await db.insert(chats).values({ id: newIdValue, title, scope, msgs: JSON.stringify(clean), createdAt: now, updatedAt: now });
  return newIdValue;
}

export async function listChats(): Promise<ChatSummary[]> {
  await guard();
  const rows = await db.select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt }).from(chats).orderBy(sql`${chats.updatedAt} desc`).limit(100);
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.getTime() }));
}

export async function loadChat(id: string): Promise<{ id: string; scope: string; msgs: ChatMsg[] } | null> {
  await guard();
  const [row] = await db.select().from(chats).where(eq(chats.id, id));
  if (!row) return null;
  try { return { id: row.id, scope: row.scope, msgs: JSON.parse(row.msgs) }; } catch { return { id: row.id, scope: row.scope, msgs: [] }; }
}

export async function deleteChat(id: string) {
  await guard();
  await db.delete(chats).where(eq(chats.id, id));
}

// ——— Notifiche ———

export async function pushPublicKey() {
  await guard();
  return vapidPublicKey();
}

/** Iscrive questo dispositivo alle notifiche (oggetto PushSubscription serializzato). */
export async function subscribePush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, device: string) {
  await guard();
  if (!/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return;
  const values = { p256dh: sub.keys.p256dh, auth: sub.keys.auth, device: device.slice(0, 120) };
  await db.insert(pushSubs).values({ endpoint: sub.endpoint, createdAt: new Date(), ...values }).onConflictDoUpdate({ target: pushSubs.endpoint, set: values });
  refreshAll();
}

export async function unsubscribePush(endpoint: string) {
  await guard();
  await db.delete(pushSubs).where(eq(pushSubs.endpoint, endpoint));
  refreshAll();
}

export async function testPush() {
  await guard();
  return sendPush({ title: "Second Brain", body: "Le notifiche funzionano su questo dispositivo.", url: "/", tag: "test" });
}

export async function saveNotifyPrefs(p: NotifyPrefs) {
  await guard();
  const clean: NotifyPrefs = {
    daily: !!p.daily,
    dailyTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(p.dailyTime) ? p.dailyTime : DEFAULT_PREFS.dailyTime,
    ready: !!p.ready,
  };
  await setSetting("notify", JSON.stringify(clean));
  refreshAll();
}

// ——— Impostazioni ———

/** apiKey: undefined = invariata, "" = rimuovi (torna al .env), altrimenti nuova chiave. */
export async function saveAiSettings(input: { apiKey?: string; models: AiModels; privacy: AiPrivacy; budgetEur: number }) {
  await guard();
  if (input.apiKey?.trim() && !isOpenRouterKey(input.apiKey)) return { error: "Questa non è una chiave OpenRouter: deve iniziare con «sk-or-»." };
  if (input.apiKey !== undefined) await setSetting("openrouter_key", input.apiKey.trim() || null);
  const m = Object.fromEntries(Object.entries(input.models).map(([k, v]) => [k, String(v ?? "").trim()])) as AiModels;
  await setSetting("ai_model", m.fast || null);
  await setSetting("ai_models", JSON.stringify({ files: m.files, smart: m.smart, expert: m.expert, embed: m.embed }));
  const privacy: AiPrivacy = input.privacy === "zdr" || input.privacy === "allow" ? input.privacy : "deny";
  await setSetting("ai_privacy", privacy);
  await setSetting("ai_data_collection", privacy === "allow" ? "allow" : "deny");
  await setSetting("ai_budget", String(Math.max(0, Math.min(1000, Number(input.budgetEur) || 0))));
  await setSetting("ai_warning", null);
  resetUnavailable();
  await log("Impostazioni IA aggiornate", null, `Ragionamento ${m.smart} · veloce ${m.fast} · privacy ${privacy} · tetto €${input.budgetEur}`);
  refreshAll();
  return { ok: true as const };
}

export type AiOverview = {
  spentEur: number; budgetEur: number; calls: number;
  byTask: { task: string; eur: number; calls: number }[];
  byModel: { model: string; eur: number; calls: number }[];
  warning: { at: number; model: string; tier: string; message: string } | null;
  embed: { done: number; total: number; model: string; error: string | null; at: number } | null;
  garden: GardenStatus | null;
};

/** Spesa del mese per compito e per modello, avvisi sui modelli e stato dell'indice per significato. */
export async function aiOverview(): Promise<AiOverview> {
  await guard();
  const cfg = await getAiConfig();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const rows = await db.select().from(aiUsage).where(gte(aiUsage.at, start));
  const group = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, { eur: number; calls: number }>();
    for (const r of rows) { const k = key(r); const x = m.get(k) ?? { eur: 0, calls: 0 }; x.eur += r.cost * EUR_PER_USD; x.calls++; m.set(k, x); }
    return [...m].map(([k, v]) => ({ k, ...v })).sort((x, y) => y.eur - x.eur);
  };
  const parse = <T,>(v: string | null): T | null => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
  const warning = parse<AiOverview["warning"]>(await getSetting("ai_warning"));
  const emb = parse<AiOverview["embed"]>(await getSetting("embed_status"));
  return {
    spentEur: rows.reduce((t, r) => t + r.cost, 0) * EUR_PER_USD,
    budgetEur: cfg.budgetEur,
    calls: rows.length,
    byTask: group((r) => r.task).map(({ k, eur, calls }) => ({ task: k, eur, calls })),
    byModel: group((r) => r.model).map(({ k, eur, calls }) => ({ model: k, eur, calls })),
    warning: warning && Date.now() - warning.at < 7 * 86400000 ? warning : null,
    embed: emb ? { done: emb.done ?? 0, total: emb.total ?? 0, model: emb.model ?? cfg.models.embed, error: emb.error ?? null, at: emb.at } : null,
    garden: parse<GardenStatus>(await getSetting("garden_status")),
  };
}

/** Cura della memoria subito (pulsante nelle Impostazioni); di solito parte da sola ogni notte. */
export async function runGarden(): Promise<GardenStatus> {
  await guard();
  const s = await gardenMemory();
  refreshAll();
  return s;
}

/** Aggiorna subito l'indice per significato. */
export async function reindexNow(): Promise<{ done: number } | { error: string }> {
  await guard();
  try { return { done: await syncEmbeddings(2000) }; } catch (e) { return { error: e instanceof Error ? e.message : "Errore." }; }
}

export type CompareResult = { text: string; sources: string[]; steps: string[]; ms: number; cost: number; error: string | null };

/** Confronto modelli: una domanda sulla memoria vera con un modello scelto (solo lettura: le azioni non si eseguono). */
export async function compareRun(model: string, question: string): Promise<CompareResult> {
  await guard();
  const t0 = Date.now();
  try {
    const r = await runAgent({ question, model: model.trim(), tier: "smart", task: "confronto" });
    const rows = r.sources.length ? await db.select({ id: items.id, title: items.title }).from(items).where(inArray(items.id, r.sources)) : [];
    const text = r.text.replace(/⟦[^⟧]*⟧/g, "").replace(/\*\*/g, "").replace(/ +([.,;:])/g, "$1")
      + (r.actions.length ? `\n\nAzioni proposte: ${r.actions.map((x) => x.label).join("; ")}` : "");
    return { text, sources: rows.map((x) => x.title), steps: r.steps, ms: Date.now() - t0, cost: r.cost * EUR_PER_USD, error: null };
  } catch (e) {
    return { text: "", sources: [], steps: [], ms: Date.now() - t0, cost: 0, error: e instanceof Error ? e.message : "Errore." };
  }
}

export type KeyStatus =
  | {
      ok: true; label: string; usage: number; limit: number | null; remaining: number | null; freeTier: boolean;
      /** Conto OpenRouter: crediti acquistati, spesi e saldo (null se l'endpoint non risponde). */
      credits: { total: number; used: number; balance: number } | null;
      /** Spesa della chiave oggi, questa settimana e questo mese (se OpenRouter la fornisce). */
      daily: number | null; weekly: number | null; monthly: number | null;
    }
  | { ok: false; error: string };

/** Verifica la chiave OpenRouter e legge saldo del conto, consumo e limiti. */
export async function testAiKey(): Promise<KeyStatus> {
  await guard();
  const { apiKey } = await getAiConfig();
  if (!apiKey) return { ok: false, error: "Nessuna chiave impostata." };
  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const [res, cr] = await Promise.all([
      fetch("https://openrouter.ai/api/v1/key", { headers, signal: AbortSignal.timeout(15_000) }),
      fetch("https://openrouter.ai/api/v1/credits", { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null),
    ]);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.data) return { ok: false, error: body?.error?.message ?? `Errore ${res.status}` };
    const d = body.data;
    const c = cr?.ok ? (await cr.json().catch(() => null))?.data : null;
    const credits = c && typeof c.total_credits === "number" ? { total: c.total_credits, used: c.total_usage ?? 0, balance: c.total_credits - (c.total_usage ?? 0) } : null;
    const n = (v: unknown) => (typeof v === "number" ? v : null);
    return {
      ok: true, label: d.label ?? "", usage: d.usage ?? 0, limit: d.limit ?? null, remaining: d.limit_remaining ?? null, freeTier: !!d.is_free_tier,
      credits, daily: n(d.usage_daily), weekly: n(d.usage_weekly), monthly: n(d.usage_monthly),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "OpenRouter non raggiungibile." };
  }
}

export type ModelInfo = { id: string; name: string; input: number; output: number; audio: boolean; free: boolean; context: number; tools: boolean };

/** Modelli OpenRouter utilizzabili dall'app: devono supportare gli output strutturati. Prezzi in $ per milione di token. */
export async function listModels(): Promise<ModelInfo[] | { error: string }> {
  await guard();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { next: { revalidate: 3600 }, signal: AbortSignal.timeout(20_000) });
    const body = await res.json();
    type Raw = { id: string; name: string; context_length: number; pricing: { prompt: string; completion: string }; supported_parameters?: string[]; architecture?: { input_modalities?: string[] } };
    return (body.data as Raw[])
      .filter((m) => m.supported_parameters?.includes("structured_outputs") && !m.id.endsWith(":batch"))
      .map((m) => {
        const input = Number(m.pricing.prompt) * 1e6, output = Number(m.pricing.completion) * 1e6;
        return { id: m.id, name: m.name, input, output, audio: !!m.architecture?.input_modalities?.includes("audio"), free: input === 0 && output === 0, context: m.context_length, tools: !!m.supported_parameters?.includes("tools") };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return { error: "Impossibile leggere l'elenco dei modelli da OpenRouter." };
  }
}

/** Modelli di embedding (per la ricerca per significato). Prezzo in $ per milione di token. */
export async function listEmbeddingModels(): Promise<ModelInfo[] | { error: string }> {
  await guard();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models?output_modalities=embeddings", { next: { revalidate: 3600 }, signal: AbortSignal.timeout(20_000) });
    const body = await res.json();
    type Raw = { id: string; name: string; context_length: number; pricing: { prompt: string } };
    return (body.data as Raw[]).filter((m) => !m.id.endsWith(":batch")).map((m) => {
      const input = Number(m.pricing.prompt) * 1e6;
      return { id: m.id, name: m.name, input, output: 0, audio: false, free: input === 0, context: m.context_length, tools: false };
    }).sort((x, y) => x.input - y.input);
  } catch {
    return { error: "Impossibile leggere i modelli di embedding da OpenRouter." };
  }
}

// ——— Integrazioni: chiavi API/MCP e webhook ———

export async function createKey(name: string, scope: "read" | "write") {
  await guard();
  const res = await createApiKey(name, scope === "write" ? "write" : "read");
  await log(`Chiave API «${name.trim() || "Chiave"}» creata`, null, scope === "write" ? "Lettura e scrittura" : "Sola lettura");
  refreshAll();
  return res;
}

export async function revokeKey(id: string) {
  await guard();
  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  refreshAll();
}

export async function addWebhook(url: string, events: string[]) {
  await guard();
  const u = url.trim();
  if (!/^https?:\/\/\S+$/.test(u)) return { error: "Indirizzo non valido: deve iniziare con https://" };
  const ev = events.filter((e) => e in WEBHOOK_EVENTS);
  if (!ev.length) return { error: "Scegli almeno un evento." };
  const secret = "whsec_" + randomBytes(18).toString("base64url");
  await db.insert(webhooks).values({ id: newId("wh"), url: u, secret, events: ev, createdAt: new Date() });
  refreshAll();
  return { secret };
}

export async function deleteWebhook(id: string) {
  await guard();
  await db.delete(webhooks).where(eq(webhooks.id, id));
  refreshAll();
}

export async function testWebhook(id: string) {
  await guard();
  const [h] = await db.select().from(webhooks).where(eq(webhooks.id, id));
  if (!h) return "non trovato";
  const status = await deliver(h.id, h.url, h.secret, "test", { message: "Prova da Second Brain" });
  refreshAll();
  return status;
}

/** Profilo: nome, informazioni per l'IA e tono. */
export async function saveProfile(p: Profile) {
  await guard();
  await setSetting("profile", JSON.stringify(parseProfile(JSON.stringify(p))));
  refreshAll();
}

/** Posizioni dei nodi del grafo (vista 2D o 3D), uguali su tutti i dispositivi. */
export async function saveGraphPositions(mode: "2d" | "3d", positions: Record<string, [number, number, number]>) {
  await guard();
  if (mode !== "2d" && mode !== "3d") return;
  const clean: Record<string, [number, number, number]> = {};
  for (const [id, v] of Object.entries(positions ?? {}).slice(0, 5000)) {
    if (typeof id === "string" && id.length <= 80 && Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x))) {
      clean[id] = v.map((x) => Math.round(x * 10) / 10) as [number, number, number];
    }
  }
  await setSetting(`graph_pos_${mode}`, JSON.stringify(clean));
}

/** Disposizione dei riquadri della Home (uguale su tutti i dispositivi). */
export async function saveHomeLayout(layout: HomeLayout) {
  await guard();
  await setSetting("home", JSON.stringify(parseHome(JSON.stringify(layout))));
  refreshAll();
}

// ——— Notizie della Home ———

export async function saveNewsConfig(cfg: NewsConfig) {
  await guard();
  await setSetting("news", JSON.stringify(parseNewsConfig(JSON.stringify(cfg))));
  refreshAll();
}

/** Nuova raccolta di notizie (e, se richiesto, nuovi argomenti dalla memoria). */
export async function refreshNews(newTopics = false) {
  await guard();
  await getNewsFeed(parseNewsConfig(await getSetting("news")), { force: true, newTopics });
  refreshAll();
}

async function listSetting(key: string): Promise<string[]> {
  try { return JSON.parse((await getSetting(key)) ?? "[]"); } catch { return []; }
}

/** Nasconde una notizia dalla Home (ricordato per le ultime 500). */
export async function hideNews(id: string) {
  await guard();
  const hidden = (await listSetting("news_hidden")).filter((x) => x !== id);
  await setSetting("news_hidden", JSON.stringify([...hidden, id].slice(-500)));
  refreshAll();
}

/** Cattura una notizia nell'Inbox come link, con fonte e motivo: poi si classifica e si conferma come ogni cattura. */
export async function captureNews(a: Pick<Article, "id" | "title" | "source" | "url" | "published" | "topic" | "reason">) {
  await guard();
  const date = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" }).format(new Date(a.published));
  const text = [
    a.title,
    a.url,
    "",
    `Fonte: ${a.source || "—"} · ${date}`,
    `Argomento: ${a.topic}`,
    a.reason ? `Perché mi interessa: ${a.reason}` : "",
  ].filter((l, i) => l || i === 2).join("\n");
  const id = await captureText(text, { kind: "link", source: "Notizie", origin: "Notizie", title: a.title, wait: false });
  let map: Record<string, string> = {};
  try { map = JSON.parse((await getSetting("news_captured")) ?? "{}"); } catch { /* vuoto */ }
  map[a.id] = id;
  const entries = Object.entries(map).slice(-500);
  await setSetting("news_captured", JSON.stringify(Object.fromEntries(entries)));
  refreshAll();
  return id;
}

// ——— Meteo della Home ———

export async function saveWeatherConfig(cfg: WeatherConfig) {
  await guard();
  await setSetting("weather", JSON.stringify(parseWeatherConfig(JSON.stringify(cfg))));
  refreshAll();
}

export async function findPlaces(name: string): Promise<Place[]> {
  await guard();
  if (name.trim().length < 2) return [];
  return searchPlaces(name).catch(() => []);
}

/** Elimina un'immagine di sfondo caricata; se era quella in uso, l'app torna senza sfondo. */
export async function deleteBackground(id: string) {
  await guard();
  await db.delete(backgrounds).where(eq(backgrounds.id, id));
  await removeFiles([id]);
  const look = parseLook(await getSetting("look"));
  if (look.bg.id === "up:" + id) await setSetting("look", JSON.stringify({ ...look, bg: { ...look.bg, id: "none" } }));
  refreshAll();
}

export async function saveLook(look: Look) {
  await guard();
  await setSetting("look", JSON.stringify(parseLook(JSON.stringify(look))));
  refreshAll();
}

/** Elimina tutti i contenuti (non le impostazioni). */
export async function deleteAllData(confirmText: string) {
  await guard();
  if (confirmText !== "ELIMINA") return;
  await removeAttachments();
  // I fatti su di te restano, come il profilo e le impostazioni; impronte e suggerimenti seguono i dati.
  for (const t of [itemPeople, links, tasks, goals, items, projects, people, aiLog, chats, embeddings, insights]) await db.delete(t);
  await log("Tutti i dati eliminati", null, "Eseguita");
  refreshAll();
  redirect("/");
}


// ——— dati di esempio (dal prototipo) ———

export async function loadDemoData() {
  await guard();
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(items);
  if (n > 0) return;
  const MONTH: Record<string, number> = { gen: 0, feb: 1, mar: 2, apr: 3, mag: 4, giu: 5, lug: 6, ago: 7, set: 8, ott: 9, nov: 10, dic: 11 };
  const parse = (s: string) => {
    const m = /^(\d+) (\w+) (\d+), (\d+):(\d+)/.exec(s)!;
    return new Date(Number(m[3]), MONTH[m[2]!]!, Number(m[1]), Number(m[4]), Number(m[5]));
  };
  for (const p of demo.PROJ) {
    await db.insert(projects).values({ id: p.id, name: p.name, status: p.status as "Attivo", description: p.desc, next: p.next, pct: p.pct });
  }
  for (const p of demo.PEOPLE) {
    await db.insert(people).values({ id: p.id, name: p.name, role: p.role, org: p.org, email: p.email, note: p.note });
  }
  const kindOf: Record<string, ItemKind> = { Audio: "audio", Documento: "file", "Pagina web": "link" };
  for (const k of demo.KN as (typeof demo.KN[number] & { body?: string[] })[]) {
    await db.insert(items).values({
      id: k.id, kind: kindOf[k.type] ?? "note", status: "memory", type: k.type as Proposal["type"], title: k.title,
      content: (k.body ?? [k.summary]).join("\n\n"), summary: k.summary, source: k.source, origin: k.origin,
      projectId: k.project, tags: k.tags, favorite: k.id === "k1" || k.id === "k2",
      createdAt: parse(k.created), updatedAt: parse(k.updated), confirmedAt: parse(k.created),
    });
    for (const pid of k.people) await db.insert(itemPeople).values({ itemId: k.id, personId: pid });
  }
  const L: [string, string, "related" | "conflict", string][] = [
    ["k5", "k1", "conflict", "Il 12 settembre è stato scelto un piano unico, l'idea propone un piano gratuito."],
    ["k1", "k3", "related", "Decisione presa nella riunione"], ["k1", "k2", "related", "Strategia di lancio"],
    ["k4", "k1", "related", "Dati sui prezzi dei concorrenti"], ["k5", "k4", "related", "Entrambi parlano di piani gratuiti"],
    ["k7", "k2", "related", "Stesso progetto"],
  ];
  for (const [a, b, kind, reason] of L) await db.insert(links).values({ fromId: a, toId: b, kind, reason });
  const offset: Record<string, number[]> = { overdue: [-1], today: [0], week: [1, 4, 5], later: [11, 14, 18] };
  const used: Record<string, number> = {};
  for (const t of demo.TASKS) {
    const list = offset[t.group]!; const i = used[t.group] = (used[t.group] ?? -1) + 1;
    const d = new Date(); d.setDate(d.getDate() + list[Math.min(i, list.length - 1)]!);
    await db.insert(tasks).values({ id: t.id, title: t.title, projectId: t.project, prio: t.prio, due: isoDay(d), sourceItemId: t.src, createdAt: new Date() });
  }
  await log("Dati di esempio caricati", null, "Eseguita");
  refreshAll();
}

