import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { db, ready } from "@/lib/db";
import { removeFiles } from "@/lib/files";
import { aiLog, aimItems, aims, attachments, chats, embeddings, facts, goals, insights, itemPeople, items, links, people, projects, tasks } from "@/lib/db/schema";

// Stesso formato prodotto da /api/export?format=json. Le date arrivano come stringhe ISO.
const date = z.coerce.date();
const Backup = z.object({
  items: z.array(z.object({
    id: z.string(), kind: z.enum(["note", "link", "file", "audio"]),
    status: z.enum(["processing", "ready", "error", "memory", "archived"]),
    type: z.string().nullable(), title: z.string(), content: z.string(), summary: z.string().nullable(),
    source: z.string(), origin: z.string(), projectId: z.string().nullable(), tags: z.array(z.string()),
    proposal: z.any().nullable(), error: z.string().nullable(), favorite: z.boolean(),
    createdAt: date, updatedAt: date, confirmedAt: date.nullable(),
  })),
  projects: z.array(z.object({
    id: z.string(), name: z.string(), status: z.enum(["Attivo", "In pausa", "Chiuso"]),
    description: z.string(), next: z.string(), pct: z.number(),
  })),
  people: z.array(z.object({ id: z.string(), name: z.string(), role: z.string(), org: z.string(), email: z.string(), note: z.string() })),
  itemPeople: z.array(z.object({ itemId: z.string(), personId: z.string() })),
  links: z.array(z.object({ fromId: z.string(), toId: z.string(), kind: z.enum(["related", "conflict"]), reason: z.string() })),
  tasks: z.array(z.object({
    id: z.string(), title: z.string(), projectId: z.string().nullable(), prio: z.number(), due: z.string().nullable(),
    done: z.boolean(), sourceItemId: z.string().nullable(), createdAt: date,
    time: z.string().nullable().default(null), remind: z.number().nullable().default(null),
    remindAt: z.number().nullable().default(null), reminded: z.boolean().default(false),
    aimId: z.string().nullable().default(null),
  })),
  // Assente nei backup precedenti agli obiettivi.
  goals: z.array(z.object({ id: z.string(), projectId: z.string(), title: z.string(), done: z.boolean(), ord: z.number(), createdAt: date })).default([]),
  chats: z.array(z.object({ id: z.string(), title: z.string(), scope: z.string(), msgs: z.string(), createdAt: date, updatedAt: date })).default([]),
  // Assenti nei backup precedenti agli obiettivi personali (29/9).
  aims: z.array(z.object({
    id: z.string(), title: z.string(), description: z.string().default(""), status: z.enum(["active", "paused", "done", "dropped"]).default("active"),
    due: z.string().nullable().default(null), createdAt: date, updatedAt: date, doneAt: date.nullable().default(null),
  })).default([]),
  aimItems: z.array(z.object({ aimId: z.string(), itemId: z.string() })).default([]),
  facts: z.array(z.object({
    id: z.string(), text: z.string(), source: z.string(), createdAt: date,
    origin: z.enum(["declared", "inferred", "observed"]).default("declared"),
    status: z.enum(["confirmed", "pending", "obsolete", "conflict"]).default("confirmed"),
    confidence: z.number().nullable().default(null), sourceRef: z.string().nullable().default(null),
    validFrom: z.string().nullable().default(null), validUntil: z.string().nullable().default(null),
    lastConfirmedAt: date.nullable().default(null), supersededBy: z.string().nullable().default(null),
    category: z.enum(["personale", "lavoro", "persone", "preferenze"]).nullable().default(null),
  })).default([]),
  aiLog: z.array(z.object({ at: date, action: z.string(), itemId: z.string().nullable(), outcome: z.string() })).default([]),
  // Solo i riferimenti: i file restano sul server. Si ricollegano quelli ancora presenti.
  attachments: z.array(z.object({ id: z.string(), itemId: z.string(), name: z.string(), mime: z.string(), size: z.number(), createdAt: date })).default([]),
});

/** Ripristina un backup JSON sostituendo tutti i contenuti (le impostazioni restano). */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) return Response.json({ error: "Non autorizzato" }, { status: 401 });
  await ready();
  const form = await req.formData();
  if (form.get("confirm") !== "ELIMINA") return Response.json({ error: "Conferma mancante." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Nessun file." }, { status: 400 });

  let data: z.infer<typeof Backup>;
  try {
    const parsed = Backup.safeParse(JSON.parse(await file.text()));
    if (!parsed.success) return Response.json({ error: "Il file non è un'esportazione JSON di Second Brain valida." }, { status: 400 });
    data = parsed.data;
  } catch {
    return Response.json({ error: "Il file non è un JSON leggibile." }, { status: 400 });
  }

  const itemIds = new Set(data.items.map((i) => i.id));
  const current = await db.select({ id: attachments.id }).from(attachments);
  const currentIds = new Set(current.map((a) => a.id));
  const keep = data.attachments.filter((a) => itemIds.has(a.itemId) && currentIds.has(a.id));

  // Tutto o niente: se un inserimento fallisce, i dati attuali restano intatti.
  await db.transaction(async (tx) => {
    for (const t of [itemPeople, links, tasks, goals, aimItems, aims, items, projects, people, aiLog, attachments, chats, embeddings, insights]) await tx.delete(t);
    // I fatti su di te si sostituiscono solo se il backup li contiene (i backup vecchi non li hanno).
    if (data.facts.length) await tx.delete(facts);
    const chunks = <T,>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / 100) }, (_, i) => rows.slice(i * 100, i * 100 + 100));
    for (const c of chunks(data.projects)) await tx.insert(projects).values(c);
    for (const c of chunks(data.people)) await tx.insert(people).values(c);
    for (const c of chunks(data.items)) await tx.insert(items).values(c as (typeof items.$inferInsert)[]);
    for (const c of chunks(data.itemPeople)) await tx.insert(itemPeople).values(c).onConflictDoNothing();
    for (const c of chunks(data.links)) await tx.insert(links).values(c).onConflictDoNothing();
    for (const c of chunks(data.tasks)) await tx.insert(tasks).values(c);
    for (const c of chunks(data.goals)) await tx.insert(goals).values(c);
    for (const c of chunks(data.aims)) await tx.insert(aims).values(c);
    for (const c of chunks(data.aimItems)) await tx.insert(aimItems).values(c).onConflictDoNothing();
    for (const c of chunks(data.chats)) await tx.insert(chats).values(c);
    for (const c of chunks(data.facts)) await tx.insert(facts).values(c);
    for (const c of chunks(data.aiLog)) await tx.insert(aiLog).values(c);
    for (const c of chunks(keep)) await tx.insert(attachments).values(c);
    await tx.insert(aiLog).values({
      at: new Date(), action: `Backup ripristinato (${data.items.length} elementi, ${data.projects.length} progetti, ${data.people.length} persone, ${data.tasks.length} attività)`,
      itemId: null, outcome: "Eseguita",
    });
  });
  // I file che nessun elemento usa più vengono rimossi.
  const kept = new Set(keep.map((a) => a.id));
  await removeFiles(current.map((a) => a.id).filter((id) => !kept.has(id)));
  revalidatePath("/", "layout");
  return Response.json({ ok: true, items: data.items.length });
}
