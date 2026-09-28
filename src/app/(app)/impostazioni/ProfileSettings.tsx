"use client";

import { useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import { addFact, deleteFact, listFacts, saveProfile, updateFact, type Fact } from "@/lib/actions";
import { TONES, type Profile, type Tone } from "@/lib/profile";

export function ProfileSettings({ initial }: { initial: Profile }) {
  const [p, setP] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(p) !== JSON.stringify(initial) && !saved;
  const set = (patch: Partial<Profile>) => { setP((x) => ({ ...x, ...patch })); setSaved(false); };
  const save = () => start(async () => { await saveProfile(p); setSaved(true); });
  const row = { padding: "14px 0", borderTop: "1px solid var(--color-divider)", display: "flex", flexDirection: "column" as const, gap: 8 };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <label style={row}>
        <div><div style={{ fontSize: 15 }}>Come ti chiami</div><div className="muted" style={{ fontSize: 13 }}>L&apos;app e l&apos;IA ti chiameranno così.</div></div>
        <input className="input" value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="Il tuo nome" maxLength={60} style={{ maxWidth: 320, fontSize: 16 }} />
      </label>
      <label style={row}>
        <div><div style={{ fontSize: 15 }}>Qualcosa su di te</div><div className="muted" style={{ fontSize: 13 }}>Lavoro, città, interessi, come preferisci le risposte: l&apos;IA lo usa solo quando serve.</div></div>
        <textarea className="input" value={p.about} onChange={(e) => set({ about: e.target.value })} rows={3} maxLength={1500}
          placeholder="Es. Faccio il consulente IT a Milano, seguo la ristrutturazione di casa, preferisco risposte brevi con elenchi."
          style={{ fontSize: 15, resize: "vertical" }} />
      </label>
      <div style={row}>
        <div><div style={{ fontSize: 15 }}>Tono dell&apos;IA</div><div className="muted" style={{ fontSize: 13 }}>{TONES[p.tone].desc}</div></div>
        <div className="seg-sb" style={{ alignSelf: "flex-start" }}>
          {(Object.keys(TONES) as Tone[]).map((t) => (
            <button key={t} aria-pressed={p.tone === t} onClick={() => set({ tone: t })} style={{ height: 32, padding: "0 14px" }}>{TONES[t].label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 4 }}>
        <button className="btn btn-primary" onClick={save} disabled={pending || !dirty}>{pending ? "Salvo…" : "Salva profilo"}</button>
        {saved && <span className="muted" style={{ fontSize: 13 }}>Salvato{p.name ? `. Ciao ${p.name}!` : "."}</span>}
      </div>
    </div>
  );
}

const SOURCE: Record<string, string> = { chat: "dall'Assistente", manuale: "scritto da te", suggerimento: "da un suggerimento" };

/** Cosa l'IA sa di te: fatti confermati, passati all'IA in ogni conversazione. */
export function FactsEditor() {
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [, start] = useTransition();
  const reload = () => listFacts().then(setFacts);
  useEffect(() => { reload(); }, []);

  const add = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    start(async () => { await addFact(t, "manuale"); await reload(); });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {!facts ? <span className="muted" style={{ fontSize: 13 }}>…</span>
        : !facts.length ? <span className="muted" style={{ fontSize: 13 }}>Ancora niente. Scrivine uno qui sotto, oppure raccontalo all&apos;Assistente.</span>
        : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {facts.map((f) => (
              <div key={f.id} className="row-hover" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: "1px solid var(--color-divider)" }}>
                <span style={{ color: "var(--accent-text)", display: "flex" }}><Icon name="ai" size={13} /></span>
                {editing === f.id ? (
                  <input className="input" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { start(async () => { await updateFact(f.id, draft); setEditing(null); await reload(); }); } if (e.key === "Escape") setEditing(null); }}
                    onBlur={() => setEditing(null)} style={{ flex: 1, height: 32 }} />
                ) : (
                  <span onClick={() => { setEditing(f.id); setDraft(f.text); }} style={{ flex: 1, fontSize: 14, cursor: "text" }} title="Modifica">
                    {f.text} <span className="faint" style={{ fontSize: 12 }}>· {SOURCE[f.source] ?? f.source}</span>
                  </span>
                )}
                <button className="btn btn-ghost btn-icon" aria-label="Dimentica" title="Dimentica" onClick={() => { setFacts((l) => l!.filter((x) => x.id !== f.id)); start(() => deleteFact(f.id)); }} style={{ height: 28, width: 28, color: "var(--muted)" }}><Icon name="x" size={14} /></button>
              </div>
            ))}
          </div>
        )}
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Es. Lavoro con Rossi sul cantiere di via Roma" style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={add} disabled={!text.trim()} style={{ gap: 6 }}><Icon name="plus" size={14} />Aggiungi</button>
      </div>
    </div>
  );
}
