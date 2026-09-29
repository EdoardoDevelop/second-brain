"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Blueprint, Icon } from "@/components/ui";
import { saveAim } from "@/lib/actions";
import type { AimStatus } from "@/lib/db/schema";
import { dueInfo, dueLabel } from "@/lib/format";

export type AimCard = {
  id: string; title: string; description: string; status: AimStatus; due: string | null;
  createdAt: number; updatedAt: number; doneAt: number | null;
  openTasks: number; doneTasks: number; items: number; lastActivity: number | null;
};

export const AIM_STATUS: Record<AimStatus, string> = { active: "Attivo", paused: "In pausa", done: "Raggiunto", dropped: "Abbandonato" };
const SECTIONS: [AimStatus, string][] = [["active", "In corso"], ["paused", "In pausa"], ["done", "Raggiunti"], ["dropped", "Abbandonati"]];
const DAY = 86400000;

/** Obiettivi personali: risultati che l'utente vuole raggiungere, anche fuori dai progetti. */
export function AimsView({ aims }: { aims: AimCard[] }) {
  const [creating, setCreating] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const closed = aims.filter((a) => a.status === "done" || a.status === "dropped").length;

  return (
    <div className="page" style={{ maxWidth: 1320, gap: 28 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ margin: 0, fontSize: 40 }}>Obiettivi</h1>
          <div className="muted" style={{ fontSize: 14, maxWidth: 620 }}>I risultati che vuoi raggiungere, anche fuori dai progetti. L&apos;IA li tiene presenti nei suggerimenti e nelle risposte.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)} style={{ gap: 6, height: 34 }}><Icon name="plus" />Nuovo obiettivo</button>
      </div>

      {creating && <AimForm onClose={() => setCreating(false)} />}

      {!aims.length ? (
        !creating && (
          <div className="empty" style={{ padding: "64px 24px" }}>
            <span className="faint"><Icon name="target" size={20} /></span>
            <div className="empty-title" style={{ fontSize: 22 }}>Nessun obiettivo</div>
            <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 420 }}>
              Per esempio «cambiare lavoro entro marzo». Puoi anche dirlo all&apos;IA: «il mio obiettivo è…».
            </p>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>Nuovo obiettivo</button>
          </div>
        )
      ) : (
        SECTIONS.filter(([s]) => (s === "done" || s === "dropped" ? showClosed : true)).map(([s, label]) => {
          const list = aims.filter((a) => a.status === s);
          if (!list.length) return null;
          return (
            <section key={s} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="eyebrow">{label} · {list.length}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 24 }}>
                {list.map((a) => <Card key={a.id} a={a} />)}
              </div>
            </section>
          );
        })
      )}
      {closed > 0 && (
        <button className="link-btn" onClick={() => setShowClosed((v) => !v)} style={{ alignSelf: "flex-start", fontSize: 13, color: "var(--accent-text)", display: "flex", alignItems: "center", gap: 4 }}>
          <Icon name={showClosed ? "chevD" : "chevR"} size={12} />{showClosed ? "Nascondi" : "Mostra"} raggiunti e abbandonati ({closed})
        </button>
      )}
    </div>
  );
}

function Card({ a }: { a: AimCard }) {
  const total = a.openTasks + a.doneTasks;
  const pct = total ? Math.round((a.doneTasks / total) * 100) : 0;
  const due = a.due ? dueInfo(a.due) : null;
  const idle = a.status === "active" && Date.now() - (a.lastActivity ?? a.createdAt) > 21 * DAY;
  return (
    <Link href={`/obiettivi/${a.id}`} style={{ color: "inherit", textDecoration: "none" }}>
      <Blueprint className="card-hover" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, color: a.status === "active" ? "var(--accent-text)" : "var(--muted)" }}>
            <Icon name={a.status === "done" ? "check" : "target"} size={13} />{AIM_STATUS[a.status]}
          </span>
          {due && a.status !== "done" && <span style={{ fontSize: 12, color: due.group === "overdue" ? "var(--danger)" : "var(--muted)" }}>entro {dueLabel(a.due!).toLowerCase()}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 23 }}>{a.title}</h3>
          {a.description && <p className="muted" style={{ margin: 0, fontSize: 14, textWrap: "pretty", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{a.description}</p>}
        </div>
        {total > 0 && (
          <div style={{ height: 3, background: "var(--skel)" }}>
            <div style={{ height: 3, width: pct + "%", background: a.status === "active" ? "var(--color-accent)" : "var(--muted)" }} />
          </div>
        )}
        <div className="muted" style={{ fontSize: 12, marginTop: "auto" }}>
          {total ? `${a.doneTasks} di ${total} attività fatte` : "Nessuna attività"} · {a.items} {a.items === 1 ? "elemento" : "elementi"}
          {idle && <span style={{ color: "#d98a1c" }}> · fermo da oltre 3 settimane</span>}
        </div>
      </Blueprint>
    </Link>
  );
}

/** Nuovo obiettivo: titolo, scadenza facoltativa, perché conta. */
export function AimForm({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const create = () => {
    if (!title.trim()) return;
    start(async () => {
      const id = await saveAim(null, { title, description, due: due || null, status: "active" });
      router.push(`/obiettivi/${id}`);
    });
  };
  return (
    <Blueprint style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") onClose(); }}
        placeholder="Cosa vuoi raggiungere? (es. cambiare lavoro)" autoFocus aria-label="Obiettivo" style={{ fontSize: 16 }} />
      <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Perché conta, come capirai di averlo raggiunto (facoltativo)" style={{ fontSize: 14 }} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          Entro <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: 170 }} />
        </label>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={onClose} style={{ color: "var(--muted)" }}>Annulla</button>
        <button className="btn btn-primary" disabled={pending || !title.trim()} onClick={create}>{pending ? "Creo…" : "Crea obiettivo"}</button>
      </div>
    </Blueprint>
  );
}
