"use client";

import { useState, useTransition } from "react";
import { saveProfile } from "@/lib/actions";
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
