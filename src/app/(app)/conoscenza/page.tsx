import { KnowledgeView } from "./KnowledgeView";
import { getMemory, getProjects } from "@/lib/queries";
import { shortDate } from "@/lib/format";

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ q }, memory, projects] = await Promise.all([searchParams, getMemory(), getProjects()]);
  return (
    <KnowledgeView
      initialQuery={q ?? ""}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      rows={memory.map((m) => ({
        id: m.id, kind: m.kind, type: m.type, title: m.title, summary: m.summary, content: m.content.slice(0, 600),
        tags: m.tags, origin: m.origin, date: shortDate(m.createdAt), ts: m.createdAt.getTime(),
        favorite: m.favorite, projectId: m.projectId, links: m.linkCount, conflict: m.conflict,
      }))}
    />
  );
}
