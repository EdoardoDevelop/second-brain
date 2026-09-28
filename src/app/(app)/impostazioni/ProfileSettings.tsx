"use client";

import { useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import { addFact, deleteFact, endFact, listFacts, restoreFact, saveProfile, updateFact, type Fact } from "@/lib/actions";
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

const SOURCE: Record<string, string> = { chat: "dall'Assistente", comando: "da un comando", manuale: "scritto da te", suggerimento: "da un suggerimento" };
const ORIGIN: Record<string, string> = { declared: "detto da te", inferred: "dedotto dall'IA", observed: "letto in un elemento" };
const dayLabel = (d: string | number) =>
  new Date(typeof d === "string" ? d + "T12:00:00" : d).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });

/** Da dove viene un fatto e da quando vale, in una riga. */
function factMeta(f: Fact) {
  const parts = [f.origin === "declared" ? SOURCE[f.source] ?? f.source : ORIGIN[f.origin]];
  if (f.origin === "inferred" && f.confidence != null) parts.push(`sicuro al ${Math.round(f.confidence * 100)}%`);
  if (f.status === "obsolete") parts.push(f.validUntil ? `fino al ${dayLabel(f.validUntil)}` : "non più vero");
  else parts.push(f.validFrom ? `dal ${dayLabel(f.validFrom)}` : `dal ${dayLabel(f.createdAt)}`);
  if (f.lastConfirmedAt && f.status !== "obsolete" && Date.now() - f.lastConfirmedAt > 30 * 86400000) parts.push(`confermato il ${dayLabel(f.lastConfirmedAt)}`);
  return parts.join(" · ");
}

/**
 * Cosa l'IA sa di te: i fatti validi (passati all'IA in ogni conversazione) con provenienza e data,
 * e quelli non più veri, che restano come storia e si possono ripristinare.
 */
export function FactsEditor() {
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [, start] = useTransition();
  const reload = () => listFacts().then(setFacts);
  useEffect(() => { reload(); }, []);

  const add = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    start(async () => { await addFact(t, "manuale"); await reload(); });
  };
  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); await reload(); });

  const current = facts?.filter((f) => f.status !== "obsolete") ?? [];
  const past = facts?.filter((f) => f.status === "obsolete") ?? [];
  const small = { height: 28, width: 28, color: "var(--muted)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {!facts ? <span className="muted" style={{ fontSize: 13 }}>…</span>
        : !current.length ? <span className="muted" style={{ fontSize: 13 }}>Ancora niente. Scrivine uno qui sotto, oppure raccontalo all&apos;Assistente.</span>
        : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {current.map((f) => (
              <div key={f.id} className="row-hover" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: "1px solid var(--color-divider)" }}>
                <span style={{ color: f.status === "confirmed" ? "var(--accent-text)" : "var(--danger)", display: "flex" }} title={f.status === "conflict" ? "In conflitto" : f.status === "pending" ? "Da confermare" : "Confermato"}>
                  <Icon name={f.status === "confirmed" ? "check" : "alert"} size={13} />
                </span>
                {editing === f.id ? (
                  <input className="input" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { act(async () => { await updateFact(f.id, draft); setEditing(null); }); } if (e.key === "Escape") setEditing(null); }}
                    onBlur={() => setEditing(null)} style={{ flex: 1, height: 32 }} />
                ) : (
                  <span onClick={() => { setEditing(f.id); setDraft(f.text); }} style={{ flex: 1, minWidth: 0, cursor: "text", display: "flex", flexDirection: "column", gap: 1 }} title="Modifica">
                    <span style={{ fontSize: 14 }}>{f.text}</span>
                    <span className="faint" style={{ fontSize: 12 }}>{factMeta(f)}</span>
                  </span>
                )}
                <button className="btn btn-ghost btn-icon" aria-label="Non più vero" title="Non più vero: resta come storia" onClick={() => act(() => endFact(f.id))} style={small}><Icon name="archive" size={14} /></button>
                <button className="btn btn-ghost btn-icon" aria-label="Dimentica" title="Dimentica" onClick={() => { setFacts((l) => l!.filter((x) => x.id !== f.id)); start(() => deleteFact(f.id)); }} style={small}><Icon name="x" size={14} /></button>
              </div>
            ))}
          </div>
        )}
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Es. Lavoro con Rossi sul cantiere di via Roma" style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={add} disabled={!text.trim()} style={{ gap: 6 }}><Icon name="plus" size={14} />Aggiungi</button>
      </div>
      {past.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <button className="link-btn muted" onClick={() => setShowPast((v) => !v)} style={{ alignSelf: "flex-start", fontSize: 12.5 }}>
            {showPast ? "Nascondi i fatti non più veri" : `Non più veri (${past.length}): la storia che l'IA conosce ma non usa come attuale`}
          </button>
          {showPast && past.map((f) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: "1px solid var(--color-divider)", opacity: 0.75 }}>
              <span className="faint" style={{ display: "flex" }}><Icon name="archive" size={13} /></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 14, textDecoration: "line-through", textDecorationColor: "var(--muted)" }}>{f.text}</span>
                <span className="faint" style={{ fontSize: 12 }}>{factMeta(f)}{f.supersededBy ? ` · sostituito da «${f.supersededBy.text}»` : ""}</span>
              </span>
              <button className="btn btn-ghost btn-icon" aria-label="Ripristina" title="È ancora vero: ripristina" onClick={() => act(() => restoreFact(f.id))} style={small}><Icon name="refresh" size={14} /></button>
              <button className="btn btn-ghost btn-icon" aria-label="Dimentica" title="Dimentica del tutto" onClick={() => { setFacts((l) => l!.filter((x) => x.id !== f.id)); start(() => deleteFact(f.id)); }} style={small}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
