"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon, itemIcon } from "@/components/ui";
import { TaskCheck } from "@/components/TaskCheck";
import { addAimTask, deleteAim, linkAimItem, saveAim, setAimStatus } from "@/lib/actions";
import type { AimStatus, ItemKind, ItemType } from "@/lib/db/schema";
import { dueInfo, dueLabel as dueText, type DueGroup } from "@/lib/format";
import { TaskEditor } from "../../attivita/TasksView";
import { AIM_STATUS } from "../AimsView";

type Aim = { id: string; title: string; description: string; status: AimStatus; due: string | null; createdAt: number; doneAt: number | null };
type Task = { id: string; title: string; done: boolean; prio: number; due: string | null; time: string | null; remind: number | null; projectId: string | null; aimId: string | null; label: string; group: DueGroup };
type Item = { id: string; title: string; type: ItemType | null; kind: ItemKind; createdAt: number; summary: string | null };

const fmt = (ms: number) => new Date(ms).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });

export function AimClient({ aim, tasks, items, candidates, projects, aims }: {
  aim: Aim; tasks: Task[]; items: Item[]; candidates: { id: string; title: string; type: string | null }[];
  projects: { id: string; name: string }[]; aims: { id: string; title: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(aim.title);
  const [description, setDescription] = useState(aim.description);
  const [due, setDue] = useState(aim.due ?? "");
  const [text, setText] = useState("");
  const [taskEdit, setTaskEdit] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const done = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const dueLabel = aim.due ? dueInfo(aim.due) : null;
  const q = query.trim().toLowerCase();
  const matches = q ? candidates.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 8) : [];
  const ask = `Come sto andando con il mio obiettivo «${aim.title}»? Cosa c'è nella memoria che mi aiuta e quale dovrebbe essere il prossimo passo?`;

  const save = () => start(async () => {
    await saveAim(aim.id, { title, description, due: due || null, status: aim.status });
    setEditing(false);
  });
  const addTask = () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    start(() => addAimTask(aim.id, v));
  };

  return (
    <div className="page" style={{ maxWidth: 1100, gap: 32 }}>
      <Link href="/obiettivi" className="muted" style={{ fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>← Obiettivi</Link>

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Obiettivo" style={{ fontSize: 22 }} autoFocus />
          <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Perché conta, come capirai di averlo raggiunto" style={{ fontSize: 15 }} />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              Entro <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: 170 }} />
            </label>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={() => { setEditing(false); setTitle(aim.title); setDescription(aim.description); setDue(aim.due ?? ""); }} style={{ color: "var(--muted)" }}>Annulla</button>
            <button className="btn btn-primary" disabled={pending || !title.trim()} onClick={save}>Salva</button>
          </div>
        </div>
      ) : (
        <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-text)" }}>
            <Icon name="target" />Obiettivo personale · {AIM_STATUS[aim.status]}
          </div>
          <h1 className="page-title" style={{ margin: 0, fontSize: 44, letterSpacing: "-.02em", overflowWrap: "anywhere" }}>{aim.title}</h1>
          {aim.description && <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, textWrap: "pretty", whiteSpace: "pre-wrap" }}>{aim.description}</p>}
          <div className="muted" style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
            {dueLabel && <span style={{ color: dueLabel.group === "overdue" && aim.status === "active" ? "var(--danger)" : undefined }}>Entro {dueText(aim.due!).toLowerCase()}</span>}
            <span>Dal {fmt(aim.createdAt)}</span>
            {aim.doneAt && <span>Raggiunto il {fmt(aim.doneAt)}</span>}
            {tasks.length > 0 && <span>{done} di {tasks.length} attività fatte</span>}
          </div>
          {tasks.length > 0 && (
            <div style={{ height: 3, background: "var(--skel)", maxWidth: 420 }}>
              <div style={{ height: 3, width: pct + "%", background: "var(--color-accent)" }} />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            <div className="seg-sb" role="group" aria-label="Stato">
              {(["active", "paused", "done", "dropped"] as AimStatus[]).map((s) => (
                <button key={s} aria-pressed={aim.status === s} disabled={pending} onClick={() => start(() => setAimStatus(aim.id, s))} style={{ height: 32, padding: "0 12px" }}>{AIM_STATUS[s]}</button>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={() => setEditing(true)} style={{ gap: 6, height: 32 }}><Icon name="edit" size={14} />Modifica</button>
            <Link href={`/assistente?q=${encodeURIComponent(ask)}`} className="btn btn-secondary" style={{ gap: 6, height: 32 }}><Icon name="ai" size={14} />Chiedi all&apos;IA</Link>
            {confirmDel ? (
              <>
                <span style={{ fontSize: 13, color: "var(--danger)" }}>Eliminare l&apos;obiettivo? Attività ed elementi restano.</span>
                <button className="btn btn-ghost" onClick={() => setConfirmDel(false)} style={{ color: "var(--muted)" }}>No</button>
                <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => { await deleteAim(aim.id); router.push("/obiettivi"); })} style={{ background: "var(--danger)", borderColor: "var(--danger)" }}>Elimina</button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => setConfirmDel(true)} style={{ gap: 6, height: 32, color: "var(--danger)" }}><Icon name="trash" size={14} />Elimina</button>
            )}
          </div>
        </header>
      )}

      <section style={{ display: "flex", flexDirection: "column" }}>
        <h4 style={{ margin: "0 0 10px", fontSize: 20 }}>Attività {tasks.length > 0 && <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{tasks.length - done} aperte</span>}</h4>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", height: 44, border: "1px dashed var(--color-divider)" }}>
          <span className="muted"><Icon name="plus" /></span>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTask(); }} placeholder="Un passo verso l'obiettivo, poi Invio" aria-label="Nuova attività"
            style={{ flex: 1, border: 0, background: "none", color: "var(--color-text)", font: "inherit", fontSize: 15, outline: "none" }} />
        </div>
        {tasks.map((t) => taskEdit === t.id ? (
          <TaskEditor key={t.id} task={t} projects={projects} aims={aims} onClose={() => setTaskEdit(null)} />
        ) : (
          <div key={t.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr) auto 28px", gap: 14, alignItems: "center", padding: "11px 8px", borderTop: "1px solid var(--color-divider)" }}>
            <TaskCheck id={t.id} done={t.done} size={18} />
            <span onClick={() => setTaskEdit(t.id)} style={{ fontSize: 15, cursor: "text", textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--muted)" : "var(--color-text)", minWidth: 0, overflowWrap: "anywhere" }}>{t.title}</span>
            <span style={{ fontSize: 13, color: t.group === "overdue" && !t.done ? "var(--danger)" : "var(--muted)" }}>{t.label}</span>
            <button className="btn btn-ghost" onClick={() => setTaskEdit(t.id)} aria-label="Modifica attività" style={{ height: 28, width: 28, padding: 0, justifyContent: "center", color: "var(--muted)" }}><Icon name="edit" size={14} /></button>
          </div>
        ))}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h4 style={{ margin: 0, fontSize: 20 }}>Nella memoria {items.length > 0 && <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{items.length}</span>}</h4>
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", height: 44, border: "1px dashed var(--color-divider)" }}>
            <span className="muted"><Icon name="link" /></span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Collega una nota, un documento, una decisione…" aria-label="Cerca un elemento da collegare"
              style={{ flex: 1, border: 0, background: "none", color: "var(--color-text)", font: "inherit", fontSize: 15, outline: "none" }} />
          </div>
          {matches.length > 0 && (
            <div className="blueprint" style={{ position: "absolute", left: 0, right: 0, top: 46, zIndex: 5, background: "var(--color-bg)", display: "flex", flexDirection: "column", boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>
              {matches.map((m) => (
                <button key={m.id} className="list-btn" onClick={() => { setQuery(""); start(() => linkAimItem(aim.id, m.id, true)); }}
                  style={{ gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, padding: "10px 12px", textAlign: "left" }}>
                  <span style={{ fontSize: 14 }}>{m.title}</span><span className="muted" style={{ fontSize: 12 }}>{m.type ?? "Nota"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {!items.length && <div className="muted" style={{ fontSize: 14 }}>Nessun elemento collegato. Si collegano anche dal dettaglio di un elemento o chiedendolo all&apos;IA.</div>}
        {items.map((i) => (
          <div key={i.id} style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr) 28px", gap: 12, alignItems: "start", padding: "10px 0", borderTop: "1px solid var(--color-divider)" }}>
            <span className="muted" style={{ paddingTop: 2 }}><Icon name={itemIcon(i.type, i.kind)} /></span>
            <Link href={`/conoscenza/${i.id}`} style={{ color: "inherit", textDecoration: "none", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 15 }}>{i.title}</span>
              <span className="muted" style={{ fontSize: 12 }}>{i.type ?? "Nota"} · {fmt(i.createdAt)}{i.summary ? ` · ${i.summary.slice(0, 120)}` : ""}</span>
            </Link>
            <button className="btn btn-ghost" onClick={() => start(() => linkAimItem(aim.id, i.id, false))} aria-label="Scollega" title="Scollega dall'obiettivo" style={{ height: 28, width: 28, padding: 0, justifyContent: "center", color: "var(--muted)" }}><Icon name="x" size={14} /></button>
          </div>
        ))}
      </section>
    </div>
  );
}
