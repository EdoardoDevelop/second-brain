"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import { addProjectTask, type ProjectInput } from "@/lib/actions";
import { ProjectForm } from "../ProjectForm";
import { TaskCheck } from "@/components/TaskCheck";
import { TaskEditor, type EditableTask } from "../../attivita/TasksView";

/** Intestazione del progetto con il passaggio al modulo di modifica. */
export function ProjectHeader({ id, initial, children }: { id: string; initial: ProjectInput; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <ProjectForm id={id} initial={initial} onClose={() => setEditing(false)} />;
  return (
    <header className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 24, alignItems: "end" }}>
      {children}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-secondary" onClick={() => setEditing(true)} style={{ gap: 6 }}>Modifica</button>
        <Link className="btn btn-secondary" href={`/connessioni?nodo=${id}`} style={{ gap: 6 }}><Icon name="graph" />Grafo</Link>
        <Link className="btn btn-primary" href={`/assistente?ambito=project:${id}&q=${encodeURIComponent(`Cosa dovrei sapere sul progetto ${initial.name}?`)}`} style={{ gap: 6 }}><Icon name="ai" />Chiedi su questo progetto</Link>
      </div>
    </header>
  );
}

export function AddProjectTask({ projectId }: { projectId: string }) {
  const [text, setText] = useState("");
  const [, start] = useTransition();
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    start(() => addProjectTask(projectId, v));
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", height: 40, border: "1px dashed var(--color-divider)" }}>
      <span className="muted"><Icon name="plus" /></span>
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="Aggiungi un'attività al progetto" style={{ flex: 1, border: 0, background: "none", color: "var(--color-text)", font: "inherit", fontSize: 14, outline: "none" }} />
    </div>
  );
}

type PT = EditableTask & { done: boolean; label: string; overdue: boolean };

/** Attività del progetto: clic sul titolo o sulla matita per modificarle o eliminarle. */
export function ProjectTasks({ tasks, projects }: { tasks: PT[]; projects: { id: string; name: string }[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  return tasks.map((t) => editing === t.id ? (
    <TaskEditor key={t.id} task={t} projects={projects} onClose={() => setEditing(null)} />
  ) : (
    <div key={t.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr) auto 28px", gap: 12, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--color-divider)" }}>
      <TaskCheck id={t.id} done={t.done} />
      <span onClick={() => setEditing(t.id)} title="Modifica" style={{ fontSize: 15, cursor: "text", textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--muted)" : undefined }}>{t.title}</span>
      <span style={{ fontSize: 12, color: t.overdue && !t.done ? "var(--danger)" : "var(--muted)" }}>{t.label}{t.due && t.time ? ` · ${t.time}` : ""}</span>
      <button className="btn btn-ghost" onClick={() => setEditing(t.id)} aria-label="Modifica attività" title="Modifica o elimina" style={{ height: 28, width: 28, padding: 0, justifyContent: "center", color: "var(--muted)" }}><Icon name="edit" size={14} /></button>
    </div>
  ));
}
