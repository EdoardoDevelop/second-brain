import { InboxView } from "./InboxView";
import { aiEnabled } from "@/lib/ai";
import { getInbox, getMemory, getProjects } from "@/lib/queries";
import { relTime, shortDate } from "@/lib/format";

export default async function InboxPage() {
  const [inbox, memory, projects] = await Promise.all([getInbox(), getMemory(), getProjects()]);
  return (
    <InboxView
      aiOn={await aiEnabled()}
      items={inbox.map((i) => ({ id: i.id, kind: i.kind, status: i.status, title: i.title, content: i.content, source: i.source, time: relTime(i.createdAt), error: i.error, proposal: i.proposal }))}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      memory={Object.fromEntries(memory.map((m) => [m.id, { title: m.title, meta: `${m.type ?? "Nota"} · ${shortDate(m.createdAt)}`, type: m.type, kind: m.kind }]))}
    />
  );
}
