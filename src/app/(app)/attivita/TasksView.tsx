"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import { TaskCheck } from "@/components/TaskCheck";
import { addTask, deleteTask, setTaskDue, updateTask } from "@/lib/actions";
import { REMIND_OPTIONS, type DueGroup } from "@/lib/format";

type T = { id: string; title: string; done: boolean; prio: number; due: string | null; time: string | null; remind: number | null; group: DueGroup; label: string; projectId: string | null; project: string | null; srcId: string | null; src: string | null; aimId: string | null; aim: string | null };

const GROUPS: [DueGroup, string][] = [["overdue", "Scadute"], ["today", "Oggi"], ["week", "Questa settimana"], ["later", "Più avanti"], ["none", "Senza scadenza"]];
const FILTERS = ["Aperte", "Oggi", "Completate", "Tutte"] as const;
const PRIO = ["", "Bassa", "Media", "Alta"];

export function TasksView({ tasks, projects, aims }: { tasks: T[]; projects: { id: string; name: string }[]; aims: { id: string; title: string }[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Aperte");
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [, start] = useTransition();

  const visible = tasks.filter((t) =>
    filter === "Tutte" ? true : filter === "Completate" ? t.done : filter === "Oggi" ? !t.done && (t.group === "today" || t.group === "overdue") : !t.done,
  );
  const open = tasks.filter((t) => !t.done).length;

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    start(() => addTask(v));
  };

  return (
    <div className="page" style={{ maxWidth: 1080, gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ margin: 0, fontSize: 40 }}>Attività</h1>
          <div className="muted" style={{ fontSize: 14 }}>{open} aperte · ogni attività ricorda da dove è nata</div>
        </div>
        <div className="seg-sb">
          {FILTERS.map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} style={{ height: 32, padding: "0 12px" }}>{f}</button>)}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", height: 44, border: "1px dashed var(--color-divider)" }}>
        <span className="muted"><Icon name="plus" /></span>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="Aggiungi un'attività e premi Invio" style={{ flex: 1, border: 0, background: "none", color: "var(--color-text)", font: "inherit", fontSize: 15, outline: "none" }} />
      </div>

      {!tasks.length ? (
        <div className="empty" style={{ padding: "64px 24px" }}>
          <span className="faint"><Icon name="tasks" size={20} /></span>
          <div className="empty-title" style={{ fontSize: 22 }}>Niente da fare</div>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>Le attività create da note, riunioni o dall&apos;IA compariranno qui.</p>
        </div>
      ) : !visible.length ? (
        <div className="muted" style={{ padding: 48, textAlign: "center", border: "1px dashed var(--color-divider)" }}>Nessuna attività in questa vista.</div>
      ) : (
        GROUPS.map(([g, title]) => {
          const list = visible.filter((t) => t.group === g);
          if (!list.length) return null;
          return (
            <section key={g} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "14px 0 8px" }}>
                <h4 style={{ margin: 0, fontSize: 19 }}>{title}</h4>
                <span className="muted" style={{ fontSize: 13 }}>{list.length}</span>
              </div>
              {list.map((t) => editing === t.id ? (
                <TaskEditor key={t.id} task={t} projects={projects} aims={aims} onClose={() => setEditing(null)} />
              ) : (
                <div key={t.id} className="row-hover task-row" style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr) 150px 70px 130px 28px", gap: 16, alignItems: "center", padding: "12px 10px", borderTop: "1px solid var(--color-divider)" }}>
                  <span className="tr-check" style={{ display: "flex" }}><TaskCheck id={t.id} done={t.done} size={18} /></span>
                  <div className="tr-main" style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span onClick={() => setEditing(t.id)} title="Modifica" style={{ fontSize: 15, cursor: "text", textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--muted)" : "var(--color-text)" }}>{t.title}</span>
                    {t.aimId && t.aim && (
                      <Link href={`/obiettivi/${t.aimId}`} className="muted" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, textDecoration: "none" }}>
                        <Icon name="target" size={12} />per {t.aim}
                      </Link>
                    )}
                    {t.srcId && (
                      <Link href={`/conoscenza/${t.srcId}`} className="muted" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, textDecoration: "none" }}>
                        <Icon name="link" size={12} />da {t.src}
                      </Link>
                    )}
                  </div>
                  <div className="tr-meta" style={{ display: "contents" }}>
                  <span className="tr-proj">{t.project && <span className="ellipsis" style={{ display: "inline-block", maxWidth: "100%", fontSize: 12, padding: "2px 8px", background: "var(--sel)", color: "var(--accent-text)" }}>{t.project}</span>}</span>
                  <span title={PRIO[t.prio]} style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 12 }}>
                    <span style={{ width: 4, height: 5, background: "var(--color-accent)" }} />
                    <span style={{ width: 4, height: 8, background: t.prio >= 2 ? "var(--color-accent)" : "var(--skel)" }} />
                    <span style={{ width: 4, height: 11, background: t.prio >= 3 ? "var(--color-accent)" : "var(--skel)" }} />
                    <span className="muted" style={{ fontSize: 12, marginLeft: 6, lineHeight: 1 }}>{PRIO[t.prio]}</span>
                  </span>
                  <label style={{ position: "relative", fontSize: 13, textAlign: "right", cursor: "pointer", color: t.group === "overdue" && !t.done ? "var(--danger)" : t.group === "today" ? "var(--color-text)" : "var(--muted)" }}>
                    {t.label || "Aggiungi data"}
                    {t.due && t.time && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 6 }}>{t.remind != null && !t.done && <Bell />}{t.time}</span>}
                    <input
                      type="date"
                      value={t.due ?? ""}
                      onChange={(e) => start(() => setTaskDue(t.id, e.target.value || null))}
                      style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                      aria-label="Scadenza"
                    />
                  </label>
                  </div>
                  <button className="btn btn-ghost tr-edit" onClick={() => setEditing(t.id)} aria-label="Modifica attività" title="Modifica o elimina" style={{ height: 28, width: 28, padding: 0, justifyContent: "center", color: "var(--muted)" }}><Icon name="edit" size={14} /></button>
                </div>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function Bell() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Promemoria">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export type EditableTask = Pick<T, "id" | "title" | "prio" | "due" | "time" | "remind" | "projectId"> & { aimId?: string | null };

/**
 * Editor in linea di un'attività (titolo, progetto, obiettivo, priorità, scadenza, orario, promemoria, elimina).
 * Usato anche nel dettaglio del progetto e dell'obiettivo; senza `aims` l'obiettivo non si mostra e non cambia.
 */
export function TaskEditor({ task, projects, aims, onClose }: { task: EditableTask; projects: { id: string; name: string }[]; aims?: { id: string; title: string }[]; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [projectId, setProjectId] = useState(task.projectId ?? "");
  const [aimId, setAimId] = useState(task.aimId ?? "");
  const [prio, setPrio] = useState(task.prio);
  const [due, setDue] = useState(task.due ?? "");
  const [time, setTime] = useState(task.time ?? "");
  const [remind, setRemind] = useState<string>(task.remind == null ? "" : String(task.remind));
  const [confirmDel, setConfirmDel] = useState(false);
  const [pending, start] = useTransition();
  const save = () => {
    if (!title.trim()) return;
    start(async () => { await updateTask(task.id, { title, projectId: projectId || null, prio, due: due || null, time: due && time ? time : null, remind: due && time && remind !== "" ? Number(remind) : null, ...(aims ? { aimId: aimId || null } : {}) }); onClose(); });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, borderTop: "1px solid var(--color-divider)", background: "var(--raised)", animation: "sbIn .15s ease" }}>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }} autoFocus aria-label="Titolo" style={{ fontSize: 15 }} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, flex: "1 1 200px" }}>
          <span className="muted">Progetto</span>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Nessun progetto</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {aims && (aims.length > 0 || aimId) && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, flex: "1 1 200px" }}>
            <span className="muted">Obiettivo</span>
            <select className="input" value={aimId} onChange={(e) => setAimId(e.target.value)}>
              <option value="">Nessun obiettivo</option>
              {aims.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          </label>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          <span className="muted">Priorità</span>
          <div className="seg-sb">
            {[1, 2, 3].map((n) => <button key={n} aria-pressed={prio === n} onClick={() => setPrio(n)} style={{ height: 34 }}>{PRIO[n]}</button>)}
          </div>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          <span className="muted">Scadenza</span>
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          <span className="muted">Orario</span>
          <input className="input" type="time" value={time} disabled={!due} onChange={(e) => { setTime(e.target.value); if (e.target.value && remind === "" && !task.time) setRemind("0"); }} style={{ width: 120 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, flex: "1 1 160px" }}>
          <span className="muted">Promemoria</span>
          <select className="input" value={remind} disabled={!due || !time} onChange={(e) => setRemind(e.target.value)}>
            <option value="">Nessuno</option>
            {REMIND_OPTIONS.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {confirmDel ? (
          <>
            <span style={{ fontSize: 14, color: "var(--danger)" }}>Eliminare l&apos;attività?</span>
            <button className="btn btn-ghost" onClick={() => setConfirmDel(false)} style={{ color: "var(--muted)" }}>No</button>
            <button className="btn btn-primary" disabled={pending} onClick={() => start(() => deleteTask(task.id))} style={{ background: "var(--danger)", borderColor: "var(--danger)" }}>Elimina</button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirmDel(true)} style={{ gap: 6, color: "var(--danger)" }}><Icon name="trash" />Elimina</button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={onClose} style={{ color: "var(--muted)" }}>Annulla</button>
        <button className="btn btn-primary" disabled={pending || !title.trim()} onClick={save}>Salva</button>
      </div>
    </div>
  );
}
