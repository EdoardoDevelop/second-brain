"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import { addGoal, deleteGoal, moveGoal, renameGoal, toggleGoal } from "@/lib/actions";

type Goal = { id: string; title: string; done: boolean };

/** Obiettivi del progetto: spunta per segnarli raggiunti, clic sul testo per modificarli, frecce per riordinarli. */
export function Goals({ projectId, goals }: { projectId: string; goals: Goal[] }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [, start] = useTransition();
  const reached = goals.filter((g) => g.done).length;

  const add = () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    start(() => addGoal(projectId, v));
  };
  const save = () => {
    if (!editing) return;
    const { id, title } = editing;
    setEditing(null);
    if (title.trim()) start(() => renameGoal(id, title));
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h4 style={{ margin: 0, fontSize: 20 }}>
        Obiettivi {goals.length > 0 && <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{reached} di {goals.length} raggiunti</span>}
      </h4>
      {goals.map((g, i) => (
        <div key={g.id} className="goal-row" style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--color-divider)" }}>
          <button type="button" onClick={() => start(() => toggleGoal(g.id))} title={g.done ? "Segna come da raggiungere" : "Segna come raggiunto"} aria-label={g.done ? "Segna come da raggiungere" : "Segna come raggiunto"}
            style={{ border: 0, background: "none", padding: 0, cursor: "pointer", color: "var(--color-accent)", display: "flex" }}>
            <Icon name={g.done ? "check" : "target"} size={18} />
          </button>
          {editing?.id === g.id ? (
            <input className="input" autoFocus value={editing.title} onChange={(e) => setEditing({ id: g.id, title: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(null); }} onBlur={save} style={{ height: 34, fontSize: 15 }} />
          ) : (
            <button type="button" onClick={() => setEditing({ id: g.id, title: g.title })} title="Modifica"
              style={{ border: 0, background: "none", padding: 0, font: "inherit", fontSize: 15, textAlign: "left", cursor: "text", color: g.done ? "var(--muted)" : "var(--color-text)", textDecoration: g.done ? "line-through" : "none", overflowWrap: "anywhere" }}>
              {g.title}
            </button>
          )}
          <div className="goal-tools" style={{ display: "flex", gap: 2 }}>
            <button className="btn btn-ghost btn-icon" onClick={() => start(() => moveGoal(g.id, -1))} disabled={i === 0} title="Sposta su" aria-label="Sposta su" style={{ height: 30, width: 30, transform: "rotate(90deg)" }}><Icon name="chevronL" size={14} /></button>
            <button className="btn btn-ghost btn-icon" onClick={() => start(() => moveGoal(g.id, 1))} disabled={i === goals.length - 1} title="Sposta giù" aria-label="Sposta giù" style={{ height: 30, width: 30, transform: "rotate(-90deg)" }}><Icon name="chevronL" size={14} /></button>
            <button className="btn btn-ghost btn-icon" onClick={() => { if (confirm(`Eliminare l'obiettivo «${g.title}»?`)) start(() => deleteGoal(g.id)); }} title="Elimina" aria-label="Elimina" style={{ height: 30, width: 30 }}><Icon name="trash" size={14} /></button>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", height: 40, border: "1px dashed var(--color-divider)" }}>
        <span className="muted"><Icon name="plus" /></span>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Aggiungi un obiettivo"
          style={{ flex: 1, border: 0, background: "none", color: "var(--color-text)", font: "inherit", fontSize: 14, outline: "none" }} />
      </div>
    </section>
  );
}
