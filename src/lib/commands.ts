import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db, newId } from "./db";
import { aimItems, aims, attachments, facts, goals, itemPeople, items, links, people, projects, tasks } from "./db/schema";
import type { CommandAction } from "./ai";
import { captureText } from "./capture";
import { isoDay, reminderFields } from "./format";
import { log } from "./pipeline";
import { emit } from "./webhooks";

/**
 * Esegue azioni già confermate (dall'utente nell'app, o da Claude via API/MCP con permesso di scrittura).
 * Restituisce quante azioni sono state eseguite.
 */
export async function executeActions(actions: CommandAction[], origin: "web" | "api"): Promise<number> {
  const done: string[] = [];
  for (const a of actions) {
    switch (a.kind) {
      case "capture":
        // La cattura passa dall'Inbox: la classificazione andrà comunque confermata.
        if (a.text?.trim()) await captureText(a.text.trim(), { kind: "note", source: origin === "web" ? "Comando" : "Claude" });
        break;
      case "add_task":
        if (!a.title?.trim()) continue;
        {
          const id = newId("ta");
          await db.insert(tasks).values({
            id, title: a.title.trim(), projectId: a.projectId, prio: a.prio ?? 2, due: a.due, createdAt: new Date(), aimId: a.goalId?.startsWith("ob") ? a.goalId : null,
            ...reminderFields(a.due, a.time, a.time ? (a.remind ?? 0) : null),
          });
          emit("task.created", { id, title: a.title.trim(), due: a.due, time: a.time, projectId: a.projectId });
        }
        break;
      case "complete_task":
      case "reopen_task":
        if (!a.taskId) continue;
        await db.update(tasks).set({ done: a.kind === "complete_task" }).where(eq(tasks.id, a.taskId));
        if (a.kind === "complete_task") emit("task.completed", { id: a.taskId });
        break;
      case "update_task": {
        if (!a.taskId) continue;
        const patch: Partial<typeof tasks.$inferInsert> = {};
        if (a.title?.trim()) patch.title = a.title.trim();
        if (a.projectId) patch.projectId = a.projectId;
        if (a.goalId?.startsWith("ob")) patch.aimId = a.goalId;
        if (a.prio != null) patch.prio = a.prio;
        if (a.due) patch.due = a.due;
        if (a.due || a.time || a.remind != null) {
          const [cur] = await db.select().from(tasks).where(eq(tasks.id, a.taskId));
          if (!cur) continue;
          Object.assign(patch, reminderFields(a.due ?? cur.due, a.time ?? cur.time, a.remind ?? (a.time ? (cur.remind ?? 0) : cur.remind)));
        }
        if (!Object.keys(patch).length) continue;
        await db.update(tasks).set(patch).where(eq(tasks.id, a.taskId));
        break;
      }
      case "delete_task":
        if (!a.taskId) continue;
        await db.delete(tasks).where(eq(tasks.id, a.taskId));
        break;
      case "set_task_due": {
        if (!a.taskId) continue;
        const [cur] = await db.select().from(tasks).where(eq(tasks.id, a.taskId));
        if (!cur) continue;
        const time = a.time ?? cur.time;
        await db.update(tasks).set({ due: a.due, ...reminderFields(a.due, time, a.time ? (a.remind ?? cur.remind ?? 0) : cur.remind) }).where(eq(tasks.id, a.taskId));
        break;
      }
      case "create_project":
        if (!a.title?.trim()) continue;
        await db.insert(projects).values({
          id: newId("pr"), name: a.title.trim(), status: a.status ?? "Attivo", description: a.description ?? "", next: a.next ?? "", pct: a.pct ?? 0,
        });
        break;
      case "update_project": {
        if (!a.projectId) continue;
        const patch: Partial<typeof projects.$inferInsert> = {};
        if (a.status) patch.status = a.status;
        if (a.pct != null) patch.pct = a.pct;
        if (a.next) patch.next = a.next;
        if (a.description) patch.description = a.description;
        if (Object.keys(patch).length) await db.update(projects).set(patch).where(eq(projects.id, a.projectId));
        break;
      }
      case "add_goal": {
        if (!a.title?.trim()) continue;
        if (!a.projectId) {
          // Obiettivo personale.
          const now = new Date();
          await db.insert(aims).values({ id: newId("ob"), title: a.title.trim(), description: a.description?.trim() ?? "", due: a.due, status: "active", createdAt: now, updatedAt: now });
          break;
        }
        const [last] = await db.select({ ord: goals.ord }).from(goals).where(eq(goals.projectId, a.projectId)).orderBy(sql`${goals.ord} desc`).limit(1);
        await db.insert(goals).values({ id: newId("go"), projectId: a.projectId, title: a.title.trim(), ord: (last?.ord ?? -1) + 1, createdAt: new Date() });
        break;
      }
      case "complete_goal":
      case "reopen_goal":
        if (!a.goalId) continue;
        if (a.goalId.startsWith("ob")) {
          const done = a.kind === "complete_goal";
          await db.update(aims).set({ status: done ? "done" : "active", doneAt: done ? new Date() : null, updatedAt: new Date() }).where(eq(aims.id, a.goalId));
        } else await db.update(goals).set({ done: a.kind === "complete_goal" }).where(eq(goals.id, a.goalId));
        break;
      case "delete_goal":
        if (!a.goalId) continue;
        if (a.goalId.startsWith("ob")) await deleteAimRows(a.goalId);
        else await db.delete(goals).where(eq(goals.id, a.goalId));
        break;
      case "update_goal": {
        if (!a.goalId) continue;
        const patch: Partial<typeof aims.$inferInsert> = { updatedAt: new Date() };
        if (a.title?.trim()) patch.title = a.title.trim();
        if (a.due) patch.due = a.due;
        if (a.description?.trim()) patch.description = a.description.trim();
        if (a.status) patch.status = a.status === "In pausa" ? "paused" : a.status === "Chiuso" ? "dropped" : "active";
        await db.update(aims).set(patch).where(eq(aims.id, a.goalId));
        break;
      }
      case "upsert_person": {
        const fields = { role: a.role, org: a.org, email: a.email };
        const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v?.trim())) as Record<string, string>;
        if (a.personId) {
          const [cur] = await db.select().from(people).where(eq(people.id, a.personId));
          if (!cur) continue;
          if (a.name?.trim()) set.name = a.name.trim();
          if (a.note?.trim()) set.note = cur.note ? `${cur.note}\n${a.note.trim()}` : a.note.trim();
          if (Object.keys(set).length) await db.update(people).set(set).where(eq(people.id, a.personId));
        } else {
          if (!a.name?.trim()) continue;
          await db.insert(people).values({ id: newId("pe"), name: a.name.trim(), note: a.note?.trim() ?? "", ...set });
        }
        break;
      }
      case "update_item": {
        if (!a.itemId) continue;
        const [cur] = await db.select().from(items).where(eq(items.id, a.itemId));
        if (!cur) continue;
        const patch: Partial<typeof items.$inferInsert> = {};
        if (a.title?.trim()) patch.title = a.title.trim();
        if (a.summary?.trim()) patch.summary = a.summary.trim();
        if (a.projectId) patch.projectId = a.projectId;
        if (a.tags?.length || a.removeTags?.length) {
          const drop = new Set((a.removeTags ?? []).map((t) => t.toLowerCase()));
          patch.tags = [...new Set([...cur.tags, ...(a.tags ?? [])])].filter((t) => !drop.has(t.toLowerCase()));
        }
        for (const personId of a.addPeople ?? []) await db.insert(itemPeople).values({ itemId: a.itemId, personId }).onConflictDoNothing();
        const toAim = a.goalId?.startsWith("ob") ? a.goalId : null;
        if (toAim) await db.insert(aimItems).values({ aimId: toAim, itemId: a.itemId }).onConflictDoNothing();
        if (!Object.keys(patch).length && !a.addPeople?.length && !toAim) continue;
        await db.update(items).set({ ...patch, updatedAt: new Date() }).where(eq(items.id, a.itemId));
        break;
      }
      case "append_item": {
        if (!a.itemId || !a.text?.trim()) continue;
        const [cur] = await db.select().from(items).where(eq(items.id, a.itemId));
        if (!cur) continue;
        await db.update(items).set({ content: cur.content ? `${cur.content}

${a.text.trim()}` : a.text.trim(), updatedAt: new Date() }).where(eq(items.id, a.itemId));
        break;
      }
      case "archive_item":
        if (!a.itemId) continue;
        await db.update(items).set({ status: "archived", updatedAt: new Date() }).where(eq(items.id, a.itemId));
        break;
      case "favorite_item":
        if (!a.itemId) continue;
        await db.update(items).set({ favorite: a.conflict !== false }).where(eq(items.id, a.itemId));
        break;
      case "link_items":
        if (!a.itemId || !a.targetId || a.itemId === a.targetId) continue;
        await db.insert(links).values({ fromId: a.itemId, toId: a.targetId, kind: a.conflict ? "conflict" : "related", reason: a.reason?.trim() ?? "" })
          .onConflictDoUpdate({ target: [links.fromId, links.toId], set: { kind: a.conflict ? "conflict" : "related", reason: a.reason?.trim() ?? "" } });
        break;
      case "merge_items":
        if (!a.itemId || !a.targetId || a.itemId === a.targetId) continue;
        if (!(await mergeItems(a.itemId, a.targetId))) continue;
        break;
      case "confirm_fact":
      case "end_fact":
      case "merge_facts":
        if (!a.factId || !(await factAction(a))) continue;
        break;
    }
    done.push(a.label);
    await log(origin === "web" ? a.label : `API: ${a.label}`, a.itemId ?? null, origin === "web" ? "Confermata da te" : "Eseguita via API");
  }
  return done.length;
}

/** Elimina un obiettivo personale: attività ed elementi restano, senza obiettivo. */
export async function deleteAimRows(id: string) {
  await db.update(tasks).set({ aimId: null }).where(eq(tasks.aimId, id));
  await db.delete(aimItems).where(eq(aimItems.aimId, id));
  await db.delete(aims).where(eq(aims.id, id));
}

/**
 * Unisce `dupId` in `keepId`: il testo si aggiunge in coda, tag, persone, collegamenti, attività e allegati passano
 * all'elemento che resta, il doppione viene archiviato (non cancellato: si può recuperare).
 */
async function mergeItems(keepId: string, dupId: string): Promise<boolean> {
  const [keep] = await db.select().from(items).where(eq(items.id, keepId));
  const [dup] = await db.select().from(items).where(eq(items.id, dupId));
  if (!keep || !dup || dup.status === "archived") return false;
  const extra = dup.content.trim() && !keep.content.includes(dup.content.trim()) ? `

— Unito da «${dup.title}»:
${dup.content.trim()}` : "";
  await db.update(items).set({
    content: keep.content + extra,
    tags: [...new Set([...keep.tags, ...dup.tags])],
    projectId: keep.projectId ?? dup.projectId,
    favorite: keep.favorite || dup.favorite,
    updatedAt: new Date(),
  }).where(eq(items.id, keepId));
  for (const r of await db.select().from(itemPeople).where(eq(itemPeople.itemId, dupId))) {
    await db.insert(itemPeople).values({ itemId: keepId, personId: r.personId }).onConflictDoNothing();
  }
  for (const l of await db.select().from(links).where(sql`${links.fromId} = ${dupId} OR ${links.toId} = ${dupId}`)) {
    const from = l.fromId === dupId ? keepId : l.fromId, to = l.toId === dupId ? keepId : l.toId;
    if (from !== to) await db.insert(links).values({ fromId: from, toId: to, kind: l.kind, reason: l.reason }).onConflictDoNothing();
  }
  await db.delete(links).where(sql`${links.fromId} = ${dupId} OR ${links.toId} = ${dupId}`);
  await db.update(tasks).set({ sourceItemId: keepId }).where(eq(tasks.sourceItemId, dupId));
  for (const r of await db.select().from(aimItems).where(eq(aimItems.itemId, dupId))) {
    await db.insert(aimItems).values({ aimId: r.aimId, itemId: keepId }).onConflictDoNothing();
  }
  await db.delete(aimItems).where(eq(aimItems.itemId, dupId));
  await db.update(attachments).set({ itemId: keepId }).where(eq(attachments.itemId, dupId));
  await db.update(items).set({ status: "archived", updatedAt: new Date() }).where(eq(items.id, dupId));
  return true;
}

/**
 * Azioni sui fatti proposte dalla cura della memoria (sempre confermate dall'utente):
 * confirm_fact = è ancora vero; end_fact = non più vero (storia, eventualmente sostituito da otherFactId);
 * merge_facts = otherFactId è un doppione di factId: il testo (se dato) diventa quello unito e il doppione si toglie.
 */
async function factAction(a: CommandAction): Promise<boolean> {
  const ids = [a.factId, a.otherFactId].filter((x): x is string => !!x);
  const rows = await db.select({ id: facts.id, status: facts.status }).from(facts).where(inArray(facts.id, ids));
  const fact = rows.find((f) => f.id === a.factId);
  const other = rows.find((f) => f.id === a.otherFactId);
  if (!fact) return false;
  const now = new Date();
  if (a.kind === "confirm_fact") {
    await db.update(facts).set({ status: "confirmed", lastConfirmedAt: now, validUntil: null, supersededBy: null }).where(eq(facts.id, fact.id));
  } else if (a.kind === "end_fact") {
    if (fact.status === "obsolete") return false;
    const yesterday = isoDay(new Date(Date.parse(isoDay() + "T12:00:00Z") - 86400000));
    await db.update(facts).set({ status: "obsolete", validUntil: yesterday, supersededBy: other?.id ?? null }).where(eq(facts.id, fact.id));
    // Il fatto che lo sostituisce è appena stato ritenuto quello vero: vale come conferma.
    if (other) await db.update(facts).set({ status: "confirmed", lastConfirmedAt: now }).where(eq(facts.id, other.id));
  } else {
    if (!other || other.id === fact.id) return false;
    const text = a.text?.replace(/\s+/g, " ").trim().slice(0, 300);
    await db.update(facts).set({ ...(text ? { text } : {}), status: "confirmed", lastConfirmedAt: now }).where(eq(facts.id, fact.id));
    await db.update(facts).set({ supersededBy: fact.id }).where(eq(facts.supersededBy, other.id));
    await db.delete(facts).where(eq(facts.id, other.id));
  }
  return true;
}
