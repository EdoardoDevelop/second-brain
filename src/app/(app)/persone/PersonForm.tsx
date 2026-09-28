"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Blueprint } from "@/components/ui";
import { deletePerson, savePerson, type PersonInput } from "@/lib/actions";

const EMPTY: PersonInput = { name: "", role: "", org: "", email: "", note: "" };

/** Modulo di creazione o modifica di una persona. */
export function PersonForm({ id, initial, onClose }: { id?: string; initial?: PersonInput; onClose: () => void }) {
  const [p, setP] = useState<PersonInput>(initial ?? EMPTY);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (patch: Partial<PersonInput>) => setP((x) => ({ ...x, ...patch }));

  const submit = () =>
    start(async () => {
      const newId = await savePerson(id ?? null, p);
      onClose();
      if (!id) router.push(`/persone/${newId}`);
    });

  return (
    <Blueprint style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="eyebrow">{id ? "Modifica persona" : "Nuova persona"}</div>
      <div className="field"><label>Nome</label><input className="input" value={p.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></div>
      <div className="field"><label>Ruolo</label><input className="input" value={p.role} onChange={(e) => set({ role: e.target.value })} /></div>
      <div className="field"><label>Organizzazione</label><input className="input" value={p.org} onChange={(e) => set({ org: e.target.value })} /></div>
      <div className="field"><label>Email</label><input className="input" type="email" value={p.email} onChange={(e) => set({ email: e.target.value })} /></div>
      <div className="field"><label>Note personali</label><textarea className="input" value={p.note} onChange={(e) => set({ note: e.target.value })} rows={3} /></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={submit} disabled={pending || !p.name.trim()}>{id ? "Salva" : "Aggiungi"}</button>
        <button className="btn btn-secondary" onClick={onClose} disabled={pending}>Annulla</button>
        {id && (
          <button
            className="btn btn-ghost"
            style={{ marginLeft: "auto", color: "var(--danger)" }}
            disabled={pending}
            onClick={() => { if (confirm("Eliminare la persona? Gli elementi collegati restano.")) start(() => deletePerson(id)); }}
          >
            Elimina
          </button>
        )}
      </div>
    </Blueprint>
  );
}
