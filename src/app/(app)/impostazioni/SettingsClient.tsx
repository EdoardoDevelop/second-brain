"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import { ACCENTS, FONTS, fontUrl, neutrals, presetOf, PRESETS, RADII, STYLES, themeCss, TINTS, type FontKey, type Look, type LookBase, type Mode, type TintKey } from "@/lib/theme";
import { BG_PRESETS, bgPreviewStyle, isUpload, uploadUrl, type Bg } from "@/lib/backgrounds";
import { deleteAllData, deleteBackground, saveLook } from "@/lib/actions";

export function ThemeSwitch({ initial }: { initial: Mode }) {
  const [mode, setMode] = useState(initial);
  const choose = (m: Mode) => {
    setMode(m);
    document.body.dataset.theme = m;
    document.cookie = `sb_theme=${m}; path=/; max-age=31536000; samesite=lax`;
    window.dispatchEvent(new Event("sb-theme"));
  };
  return (
    <div className="seg-sb">
      {([["light", "Chiaro"], ["dark", "Scuro"], ["auto", "Automatico"]] as const).map(([m, l]) => (
        <button key={m} aria-pressed={mode === m} onClick={() => choose(m)} style={{ height: 32, padding: "0 14px" }}>{l}</button>
      ))}
    </div>
  );
}

/** Applica il look alla pagina senza ricaricarla (stesso CSS generato dal server). */
function applyLook(l: Look) {
  const style = document.getElementById("sb-theme");
  if (style) style.textContent = themeCss(l);
  const url = fontUrl(l.font);
  let link = document.getElementById("sb-font") as HTMLLinkElement | null;
  if (url) {
    if (!link) { link = Object.assign(document.createElement("link"), { id: "sb-font", rel: "stylesheet" }); document.head.appendChild(link); }
    if (link.href !== url) link.href = url;
  } else link?.remove();
}

const isPresetAccent = (c: string) => (ACCENTS as readonly string[]).includes(c);

export type BgUpload = { id: string; name: string };

export function LookEditor({ initial, uploads }: { initial: Look; uploads: BgUpload[] }) {
  const [look, setLook] = useState(initial);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<number | undefined>(undefined);
  const update = (patch: Partial<Look>) => {
    const next = { ...look, ...patch };
    setLook(next);
    applyLook(next);
    setSaved("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => { await saveLook(next); setSaved("saved"); }, 500);
  };
  const active = presetOf(look);
  const section = { padding: "14px 0", borderTop: "1px solid var(--color-divider)", display: "flex", flexDirection: "column" as const, gap: 10 };
  const custom = !isPresetAccent(look.accent);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Tutti i font dei temi, per le anteprime. */}
      {(Object.keys(FONTS) as FontKey[]).map((f) => { const u = fontUrl(f); return u ? <link key={f} rel="stylesheet" href={u} /> : null; })}
      <div style={{ ...section, gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div><div style={{ fontSize: 15 }}>Tema</div><div className="muted" style={{ fontSize: 13 }}>Colori, caratteri e forme insieme. Vale su tutti i tuoi dispositivi.</div></div>
          <span className="muted" style={{ fontSize: 12 }}>{saved === "saving" ? "Salvataggio…" : saved === "saved" ? "Salvato" : ""}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {PRESETS.map((p) => <PresetCard key={p.id} name={p.name} look={p.look} active={active === p.id} onClick={() => update(p.look)} />)}
        </div>
        {!active && <div className="muted" style={{ fontSize: 12 }}>Tema personalizzato</div>}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderTop: "1px solid var(--color-divider)", flexWrap: "wrap" }}>
        <div><div style={{ fontSize: 15 }}>Stile</div><div className="muted" style={{ fontSize: 13 }}>Industry: tecnico e squadrato. Material: pulsanti a pillola e superfici piene, come le app Google.</div></div>
        <div className="seg-sb">
          {STYLES.map(([k, l]) => <button key={k} aria-pressed={look.style === k} onClick={() => update({ style: k })} style={{ height: 32, padding: "0 14px" }}>{l}</button>)}
        </div>
      </div>

      <div style={section}>
        <div><div style={{ fontSize: 15 }}>Colore d&apos;accento</div><div className="muted" style={{ fontSize: 13 }}>Pulsanti, selezioni e link.</div></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {ACCENTS.map((c) => (
            <button key={c} aria-label={c} aria-pressed={look.accent === c} onClick={() => update({ accent: c })}
              style={{ width: 30, height: 30, padding: 0, borderRadius: "50%", cursor: "pointer", background: c, border: "2px solid var(--color-bg)", boxShadow: look.accent === c ? `0 0 0 2px ${c}` : "0 0 0 1px var(--color-divider)" }} />
          ))}
          <label title="Scegli un colore" style={{ position: "relative", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", border: custom ? "2px solid var(--color-bg)" : "1px dashed var(--faint)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", background: custom ? look.accent : undefined, boxShadow: custom ? `0 0 0 2px ${look.accent}` : undefined }}>
            {!custom && <Icon name="plus" size={14} />}
            <input type="color" value={look.accent} onChange={(e) => update({ accent: e.target.value })} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} aria-label="Colore personalizzato" />
          </label>
        </div>
      </div>

      <div style={section}>
        <div><div style={{ fontSize: 15 }}>Tinta</div><div className="muted" style={{ fontSize: 13 }}>Il colore di sfondi e superfici, in chiaro e in scuro.</div></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(TINTS).map(([k, t]) => (
            <button key={k} className="suggestion" aria-pressed={look.tint === k} onClick={() => update({ tint: k as TintKey })}
              style={{ display: "flex", alignItems: "center", gap: 8, height: 32, ...(look.tint === k ? { borderColor: "var(--color-accent)", color: "var(--color-text)", background: "var(--sel)" } : {}) }}>
              <span style={{ display: "flex", border: "1px solid var(--color-divider)" }}>
                <span style={{ width: 10, height: 16, background: neutrals({ accent: look.accent, tint: k }, false).bg }} /><span style={{ width: 10, height: 16, background: neutrals({ accent: look.accent, tint: k }, true).bg }} />
              </span>{t.name}
            </button>
          ))}
        </div>
      </div>

      <BackgroundPicker bg={look.bg} uploads={uploads} onChange={(bg) => update({ bg })} />

      <div style={section}>
        <div><div style={{ fontSize: 15 }}>Carattere</div><div className="muted" style={{ fontSize: 13 }}>Titoli e testo.</div></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8 }}>
          {(Object.keys(FONTS) as FontKey[]).map((k) => {
            const f = FONTS[k];
            return (
              <button key={k} onClick={() => update({ font: k })} aria-pressed={look.font === k}
                style={{ textAlign: "left", padding: "10px 12px", cursor: "pointer", color: "var(--color-text)", background: look.font === k ? "var(--sel)" : "transparent", border: `1px solid ${look.font === k ? "var(--color-accent)" : "var(--color-divider)"}`, borderRadius: "var(--r)" }}>
                <div style={{ fontFamily: `${f.heading}, system-ui`, fontWeight: f.weight, fontSize: 19, lineHeight: 1.2 }}>{f.name}</div>
                <div className="muted" style={{ fontFamily: `${f.body}, system-ui`, fontSize: 12 }}>{f.sample}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderTop: "1px solid var(--color-divider)", flexWrap: "wrap" }}>
        <div><div style={{ fontSize: 15 }}>Forme</div><div className="muted" style={{ fontSize: 13 }}>Angoli di pulsanti, campi e riquadri.</div></div>
        <div className="seg-sb">
          {RADII.map(([r, l]) => <button key={r} aria-pressed={look.radius === Number(r)} onClick={() => update({ radius: Number(r) })} style={{ height: 32, padding: "0 12px" }}>{l}</button>)}
        </div>
      </div>
    </div>
  );
}

/** Sfondo dell'app: nessuno, motivi preimpostati o immagini caricate (eliminabili), con l'intensità. */
function BackgroundPicker({ bg, uploads: initialUploads, onChange }: { bg: Bg; uploads: BgUpload[]; onChange: (bg: Bg) => void }) {
  const [uploads, setUploads] = useState(initialUploads);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [, start] = useTransition();

  const choose = (id: string) => {
    // Le immagini partono con un'intensità più alta dei motivi.
    const strength = id === bg.id ? bg.strength : isUpload(id) ? 35 : 50;
    onChange({ id, strength });
  };
  const upload = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/backgrounds", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Errore ${res.status}`);
      setUploads((u) => [{ id: data.id, name: file.name }, ...u]);
      onChange({ id: "up:" + data.id, strength: 35 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Caricamento non riuscito.");
    }
    setBusy(false);
  };
  const remove = (u: BgUpload) => {
    if (!window.confirm(`Eliminare l'immagine «${u.name}»?`)) return;
    setUploads((list) => list.filter((x) => x.id !== u.id));
    if (bg.id === "up:" + u.id) onChange({ id: "none", strength: bg.strength });
    start(() => deleteBackground(u.id));
  };

  const tile = (id: string, label: string, extra?: ReactNode) => {
    const active = bg.id === id;
    return (
      <div key={id} style={{ position: "relative" }}>
        <button type="button" onClick={() => choose(id)} aria-pressed={active} title={label}
          style={{ width: "100%", padding: 0, cursor: "pointer", background: "var(--color-bg)", color: "var(--color-text)", border: `1px solid ${active ? "var(--color-accent)" : "var(--color-divider)"}`, boxShadow: active ? "0 0 0 1px var(--color-accent)" : undefined, borderRadius: "var(--r)", overflow: "hidden", display: "flex", flexDirection: "column", textAlign: "left" }}>
          <span style={{ position: "relative", height: 70, display: "block", background: "var(--color-bg)" }}>
            {id !== "none" && (
              <span style={{ position: "absolute", inset: 0, ...(isUpload(id) ? { background: `url("${uploadUrl(id)}") center / cover no-repeat` } : bgPreviewStyle(id)), opacity: isUpload(id) ? 1 : 0.7 }} />
            )}
            {id === "none" && <span className="muted" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>Nessuno</span>}
          </span>
          <span className="ellipsis" style={{ padding: "5px 8px", fontSize: 12, borderTop: "1px solid var(--color-divider)", display: "flex", alignItems: "center", gap: 4 }}>
            <span className="ellipsis" style={{ flex: 1 }}>{label}</span>{active && <Icon name="check" size={12} style={{ color: "var(--accent-text)", flex: "none" }} />}
          </span>
        </button>
        {extra}
      </div>
    );
  };

  return (
    <div style={{ padding: "14px 0", borderTop: "1px solid var(--color-divider)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div><div style={{ fontSize: 15 }}>Sfondo</div><div className="muted" style={{ fontSize: 13 }}>Un motivo o un&apos;immagine dietro i contenuti. I motivi prendono il colore d&apos;accento del tema.</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 8 }}>
        {tile("none", "Nessuno")}
        {BG_PRESETS.map((p) => tile(p.id, p.name))}
        {uploads.map((u) => tile("up:" + u.id, u.name,
          <button type="button" onClick={() => remove(u)} title="Elimina immagine" aria-label={`Elimina ${u.name}`}
            style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: "50%", border: 0, cursor: "pointer", background: "rgba(0,0,0,.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
            <Icon name="trash" size={13} />
          </button>,
        ))}
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          style={{ minHeight: 98, cursor: "pointer", background: "transparent", color: "var(--muted)", border: "1px dashed var(--faint)", borderRadius: "var(--r)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, font: "inherit", fontSize: 12 }}>
          {busy ? <span className="spin" /> : <Icon name="upload" />}{busy ? "Carico…" : "Carica immagine"}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
      </div>
      {error && <div className="alert"><Icon name="alert" style={{ color: "var(--danger)" }} /><span style={{ flex: 1 }}>{error}</span></div>}
      {bg.id !== "none" && (
        <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
          <span className="muted" style={{ flex: "none" }}>Intensità</span>
          <input type="range" min={5} max={100} step={5} value={bg.strength} onChange={(e) => onChange({ id: bg.id, strength: Number(e.target.value) })} style={{ flex: 1, accentColor: "var(--color-accent)" }} aria-label="Intensità dello sfondo" />
          <span className="muted" style={{ width: 36, textAlign: "right" }}>{bg.strength}%</span>
        </label>
      )}
    </div>
  );
}

/** Anteprima di un tema: metà chiara e metà scura, accento, carattere e angoli. */
function PresetCard({ name, look, active, onClick }: { name: string; look: LookBase; active: boolean; onClick: () => void }) {
  const f = FONTS[look.font];
  const pill = look.style === "material";
  const half = (n: ReturnType<typeof neutrals>, dark: boolean) => (
    <div style={{ flex: 1, background: n.bg, padding: 8, display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ fontFamily: `${f.heading}, system-ui`, fontWeight: f.weight, fontSize: 18, color: n.text, lineHeight: 1 }}>Aa</div>
      <div style={{ height: 4, width: "70%", background: n.text, opacity: 0.25, borderRadius: look.radius }} />
      <div style={{ height: 12, width: 34, background: dark ? `color-mix(in srgb, ${look.accent} 72%, white)` : look.accent, borderRadius: pill ? 999 : Math.min(look.radius, 6) }} />
    </div>
  );
  return (
    <button onClick={onClick} aria-pressed={active}
      style={{ padding: 0, cursor: "pointer", textAlign: "left", background: "transparent", color: "var(--color-text)", border: `1px solid ${active ? "var(--color-accent)" : "var(--color-divider)"}`, boxShadow: active ? "0 0 0 1px var(--color-accent)" : undefined, borderRadius: look.radius, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", height: 64 }}>{half(neutrals(look, false), false)}{half(neutrals(look, true), true)}</div>
      <div style={{ padding: "7px 10px", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--color-divider)" }}>
        {name}{active && <Icon name="check" size={13} style={{ color: "var(--accent-text)" }} />}
      </div>
    </button>
  );
}

export function DensitySwitch({ initial }: { initial: "comfortable" | "compact" }) {
  const [density, setDensity] = useState(initial);
  const choose = (d: "comfortable" | "compact") => {
    setDensity(d);
    document.body.dataset.density = d;
    document.cookie = `sb_density=${d}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <div className="seg-sb">
      {([["comfortable", "Comoda"], ["compact", "Compatta"]] as const).map(([d, l]) => (
        <button key={d} aria-pressed={density === d} onClick={() => choose(d)} style={{ height: 32, padding: "0 14px" }}>{l}</button>
      ))}
    </div>
  );
}

export function ImportBackup() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const onFile = async (file: File) => {
    const v = prompt(`Ripristinare "${file.name}"?\nTutti gli elementi, progetti, persone, attività e il registro IA attuali verranno sostituiti dal contenuto del file. Le impostazioni restano.\nScarica prima un'esportazione.\n\nScrivi ELIMINA per confermare.`);
    if (v !== "ELIMINA") return;
    setBusy(true); setMsg(null);
    try {
      const body = new FormData();
      body.set("file", file); body.set("confirm", v);
      const res = await fetch("/api/import", { method: "POST", body });
      const out = await res.json().catch(() => ({ error: "Risposta non valida dal server." }));
      if (!res.ok) setMsg({ ok: false, text: out.error ?? "Importazione non riuscita." });
      else { setMsg({ ok: true, text: `Backup ripristinato: ${out.items} elementi.` }); setTimeout(() => location.assign("/"), 1200); }
    } catch {
      setMsg({ ok: false, text: "Importazione non riuscita: connessione assente." });
    } finally { setBusy(false); }
  };
  return (
    <>
      <label className="btn btn-secondary" style={{ gap: 6, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}>
        {busy ? <span className="spin" /> : <Icon name="upload" />}Importa backup JSON
        <input type="file" accept="application/json,.json" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      </label>
      {msg && <div style={{ flexBasis: "100%", fontSize: 13, color: msg.ok ? "var(--accent-text)" : "var(--danger)" }}>{msg.text}</div>}
    </>
  );
}

export function DeleteAll() {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn btn-secondary"
      style={{ gap: 6, color: "var(--danger)" }}
      disabled={pending}
      onClick={() => {
        const v = prompt("Verranno eliminati elementi, progetti, persone, attività e registro IA. Le impostazioni restano.\nScarica prima un'esportazione.\n\nScrivi ELIMINA per confermare.");
        if (v === "ELIMINA") start(() => deleteAllData(v));
      }}
    >
      <Icon name="trash" />Elimina tutti i dati
    </button>
  );
}
