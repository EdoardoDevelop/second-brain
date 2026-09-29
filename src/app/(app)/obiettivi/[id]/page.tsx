import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { AimClient } from "./AimClient";
import { db } from "@/lib/db";
import { items } from "@/lib/db/schema";
import { dueInfo } from "@/lib/format";
import { getAimDetail, getAims, getProjects } from "@/lib/queries";

export default async function AimPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const [d, projects, all, mem] = await Promise.all([
    getAimDetail(id),
    getProjects(),
    getAims(),
    // Elementi a cui collegare l'obiettivo: i più recenti della memoria.
    db.select({ id: items.id, title: items.title, type: items.type }).from(items).where(eq(items.status, "memory")).orderBy(desc(items.createdAt)).limit(500),
  ]);
  if (!d) notFound();
  const { aim } = d;
  return (
    <AimClient
      aim={{ id: aim.id, title: aim.title, description: aim.description, status: aim.status, due: aim.due, createdAt: aim.createdAt.getTime(), doneAt: aim.doneAt?.getTime() ?? null }}
      tasks={d.tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, prio: t.prio, due: t.due, time: t.time, remind: t.remind, projectId: t.projectId, aimId: t.aimId, label: dueInfo(t.due).label, group: dueInfo(t.due).group }))}
      items={d.items.map((i) => ({ id: i.id, title: i.title, type: i.type, kind: i.kind, createdAt: i.createdAt.getTime(), summary: i.summary }))}
      candidates={mem.filter((m) => !d.items.some((i) => i.id === m.id))}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      aims={all.filter((a) => a.status === "active" || a.status === "paused" || a.id === aim.id).map((a) => ({ id: a.id, title: a.title }))}
    />
  );
}
