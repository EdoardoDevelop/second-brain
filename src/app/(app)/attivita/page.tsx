import { TasksView } from "./TasksView";
import { dueInfo, shortDate } from "@/lib/format";
import { getItemTitles, getProjects, getTasks } from "@/lib/queries";

export default async function TasksPage() {
  const [tasks, projects] = await Promise.all([getTasks(), getProjects()]);
  const sources = await getItemTitles([...new Set(tasks.map((t) => t.sourceItemId).filter((x): x is string => !!x))]);
  const projName = new Map(projects.map((p) => [p.id, p.name]));
  return (
    <TasksView
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      tasks={tasks.map((t) => {
        const src = t.sourceItemId ? sources.get(t.sourceItemId) : undefined;
        return {
          id: t.id, title: t.title, done: t.done, prio: t.prio, due: t.due, ...dueInfo(t.due), projectId: t.projectId, time: t.time, remind: t.remind,
          project: t.projectId ? projName.get(t.projectId) ?? null : null,
          srcId: src ? t.sourceItemId : null,
          src: src ? `${src.type ?? "Nota"} · ${shortDate(src.createdAt)}` : null,
        };
      })}
    />
  );
}
