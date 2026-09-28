"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Blueprint } from "@/components/ui";
import { deleteProject, saveProject, type ProjectInput } from "@/lib/actions";

const STATUSES: ProjectInput["status"][] = ["Attivo", "In pausa", "Chiuso"];
const EMPTY: ProjectInput = { name: "", status: "Attivo", description: "", next: "", pct: 0 };

/** Modulo di creazione o modifica di un progetto. */
export function ProjectForm({ id, initial, onClose }: { id?: string; initial?: ProjectInput; onClose: () => void }) {
  const [p, setP] = useState<ProjectInput>(initial ?? EMPTY);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (patch: Partial<ProjectInput>) => setP((x) => ({ ...x, ...patch }));

  const submit = () =>
    start(async () => {
      const newId = await saveProject(id ?? null, p);
      onClose();
      if (!id) router.push(`/progetti/${newId}`);
    });

  return (
    <Blueprint style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="eyebrow">{id ? "Modifica progetto" : "Nuovo progetto"}</div>
      <div className="field"><label>Nome</label><input className="input" value={p.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></div>
      <div className="field"><label>Descrizione</label><textarea className="input" value={p.description} onChange={(e) => set({ description: e.target.value })} rows={2} style={{ minHeight: 60 }} /></div>
      <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 160px 120px", gap: 12 }}>
        <div className="field"><label>Prossima milestone</label><input className="input" value={p.next} onChange={(e) => set({ next: e.target.value })} /></div>
        <div className="field">
          <label>Stato</label>
          <select className="input" value={p.status} onChange={(e) => set({ status: e.target.value as ProjectInput["status"] })}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="field"><label>Avanzamento %</label><input className="input" type="number" min={0} max={100} value={p.pct} onChange={(e) => set({ pct: Number(e.target.value) })} /></div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={submit} disabled={pending || !p.name.trim()}>{id ? "Salva" : "Crea progetto"}</button>
        <button className="btn btn-secondary" onClick={onClose} disabled={pending}>Annulla</button>
        {id && (
          <button
            className="btn btn-ghost"
            style={{ marginLeft: "auto", color: "var(--danger)" }}
            disabled={pending}
            onClick={() => { if (confirm("Eliminare il progetto? Elementi e attività restano, senza progetto.")) start(() => deleteProject(id)); }}
          >
            Elimina
          </button>
        )}
      </div>
    </Blueprint>
  );
}
