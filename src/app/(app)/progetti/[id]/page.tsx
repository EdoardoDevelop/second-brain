import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon, itemIcon } from "@/components/ui";
import { dueInfo, initials, shortDate } from "@/lib/format";
import { getProjectDetail, getProjects } from "@/lib/queries";
import { AddProjectTask, ProjectHeader, ProjectTasks } from "./ProjectClient";
import { Goals } from "./Goals";
import { BriefCard } from "@/components/BriefCard";
import { overviewHref } from "@/lib/overview-topic";
import type { SavedBrief } from "@/lib/actions";
import { aiEnabled } from "@/lib/ai";
import { getSetting } from "@/lib/settings";


export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const [d, saved, aiOn, allProjects] = await Promise.all([getProjectDetail(id), getSetting(`brief:project:${id}`), aiEnabled(), getProjects()]);
  if (!d) notFound();
  const { project: p, docs, tasks, persons, goals } = d;
  const open = tasks.filter((t) => !t.done).length;

  return (
    <div className="page" style={{ maxWidth: 1320, gap: 36 }}>
      <ProjectHeader id={p.id} initial={{ name: p.name, status: p.status, description: p.description, next: p.next, pct: p.pct }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--accent-text)" }}><Icon name="folder" />Progetto · {p.status}</div>
          <h1 className="page-title" style={{ margin: 0, fontSize: 52, letterSpacing: "-.02em", overflowWrap: "anywhere" }}>{p.name}</h1>
          {p.description && <p className="muted" style={{ margin: 0, fontSize: 17, maxWidth: 640 }}>{p.description}</p>}
        </div>
      </ProjectHeader>

      <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", borderTop: "1px solid var(--color-divider)", borderBottom: "1px solid var(--color-divider)" }}>
        <div style={{ padding: "16px 20px 16px 0", display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>Avanzamento</span>
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 28 }}>{p.pct}%</span>
          <div style={{ height: 3, background: "var(--skel)" }}><div style={{ height: 3, width: p.pct + "%", background: "var(--color-accent)" }} /></div>
        </div>
        <div style={{ padding: "16px 20px", borderLeft: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>Prossima milestone</span>
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 22 }}>{p.next || "—"}</span>
        </div>
        <div style={{ padding: "16px 20px", borderLeft: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="muted" style={{ fontSize: 12 }}>Persone</span>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {persons.length ? persons.map((x) => (
              <Link key={x.id} href={`/persone/${x.id}`} className="list-btn" style={{ display: "flex", alignItems: "center", gap: 8, border: 0, padding: 0, width: "auto", fontSize: 13 }}>
                <span className="muted" style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid var(--color-divider)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{initials(x.name)}</span>{x.name}
              </Link>
            )) : <span className="muted" style={{ fontSize: 13 }}>Nessuna persona collegata</span>}
          </div>
        </div>
      </div>

      <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 48 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 32, minWidth: 0 }}>
          <Goals projectId={p.id} goals={goals.map((g) => ({ id: g.id, title: g.title, done: g.done }))} />

          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0, fontSize: 20 }}>Attività <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{open} aperte</span></h4>
              <Link href="/attivita" className="btn btn-ghost">Tutte le attività</Link>
            </div>
            <AddProjectTask projectId={p.id} />
            <ProjectTasks
              projects={allProjects.map((x) => ({ id: x.id, name: x.name }))}
              tasks={tasks.map((t) => {
                const due = dueInfo(t.due);
                return { id: t.id, title: t.title, done: t.done, prio: t.prio, due: t.due, time: t.time, remind: t.remind, projectId: t.projectId, label: due.label, overdue: due.group === "overdue" };
              })}
            />
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h4 style={{ margin: 0, fontSize: 20 }}>Documenti e note</h4>
            {docs.length ? docs.map((k) => (
              <Link key={k.id} href={`/conoscenza/${k.id}`} className="list-btn" style={{ gridTemplateColumns: "16px minmax(0,1fr) auto", alignItems: "center" }}>
                <span className="muted"><Icon name={itemIcon(k.type, k.kind)} /></span>
                <span className="ellipsis" style={{ fontSize: 15 }}>{k.title}</span>
                <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{k.type ?? "Nota"} · {shortDate(k.createdAt)}</span>
              </Link>
            )) : <p className="muted" style={{ margin: 0, fontSize: 14 }}>Nessun elemento ancora. Assegna questo progetto quando confermi una cattura in Inbox.</p>}
          </section>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ marginBottom: 18 }}>
            <BriefCard kind="project" id={p.id} initial={saved ? (JSON.parse(saved) as SavedBrief) : null} count={docs.length + tasks.length + goals.length} aiOn={aiOn} />
            {aiOn && <Link href={overviewHref(p.name)} className="btn btn-ghost" style={{ gap: 6, marginTop: 8, color: "var(--accent-text)" }}><Icon name="ai" size={14} />Quadro completo</Link>}
          </div>
          <h4 style={{ margin: 0, fontSize: 20 }}>Timeline</h4>
          {docs.length ? (
            <div style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid var(--color-divider)", marginLeft: 4 }}>
              {docs.slice(0, 8).map((e, i) => (
                <Link key={e.id} href={`/conoscenza/${e.id}`} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 0 14px 18px", position: "relative", color: "inherit", textDecoration: "none" }}>
                  <span style={{ position: "absolute", left: -4, top: 10, width: 7, height: 7, background: "var(--color-bg)", border: "1px solid var(--color-accent)" }} />
                  <span className="muted" style={{ fontSize: 12 }}>{shortDate(e.createdAt)}</span>
                  <span style={{ fontSize: 14, fontWeight: i === 0 ? 500 : 400 }}>{e.title}</span>
                </Link>
              ))}
            </div>
          ) : <p className="muted" style={{ margin: 0, fontSize: 14 }}>La timeline si riempie con gli elementi del progetto.</p>}
        </aside>
      </div>
    </div>
  );
}
