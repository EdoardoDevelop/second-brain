"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Icon, Spinner } from "@/components/ui";
import { acceptAiAction, archive, deleteItem, itemAiAction, updateContent, updateItemMeta } from "@/lib/actions";
import { ITEM_TYPES, type ItemType } from "@/lib/db/schema";
import type { AiActionKind, AiActionResult } from "@/lib/ai";
import type { IconName } from "@/lib/icons";

const ACTIONS: [AiActionKind, string, IconName, string][] = [
  ["summarize", "Riassumi", "note", "Aggiorna la sintesi"],
  ["explain", "Spiega", "idea", "Aggiungi alla nota"],
  ["actions", "Genera attività", "tasks", "Crea attività"],
];

export function AiActions({ id, enabled }: { id: string; enabled: boolean }) {
  const [act, setAct] = useState<AiActionKind | null>(null);
  const [res, setRes] = useState<AiActionResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!enabled) return <div className="muted" style={{ fontSize: 14 }}>Imposta <code>OPENROUTER_API_KEY</code> per usare le azioni IA.</div>;

  const run = (k: AiActionKind) => {
    setAct(k); setRes(null); setErr(null);
    start(async () => {
      const r = await itemAiAction(id, k);
      if ("error" in r) setErr(r.error); else setRes(r);
    });
  };
  const accept = () => {
    if (!act || !res) return;
    start(async () => { await acceptAiAction(id, act, res); setRes(null); setAct(null); });
  };

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {ACTIONS.map(([k, label, icon]) => (
          <button key={k} className="btn btn-secondary" disabled={pending} onClick={() => run(k)} style={{ gap: 6, background: act === k ? "var(--sel)" : undefined }}>
            <Icon name={icon} />{label}
          </button>
        ))}
      </div>
      {pending && !res && (
        <div className="muted" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, paddingTop: 12, borderTop: "1px solid var(--color-divider)" }}>
          <Spinner />Leggo l&apos;elemento e i suoi collegamenti…
        </div>
      )}
      {err && <div style={{ color: "var(--danger)", fontSize: 14 }}>{err}</div>}
      {res && act && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 14, borderTop: "1px solid var(--color-divider)", animation: "sbIn .2s ease" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 18 }}>{res.title}</div>
          {res.paragraphs.map((p, i) => <p key={i} style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>{p}</p>)}
          {res.list.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {res.list.map((p, i) => <div key={i} style={{ display: "flex", gap: 10, fontSize: 15 }}><span style={{ color: "var(--color-accent)" }}>—</span>{p}</div>)}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
            <span className="muted" style={{ fontSize: 12, flex: 1 }}>Proposta · nulla viene salvato senza conferma</span>
            <button className="btn btn-ghost" onClick={() => { setRes(null); setAct(null); }} style={{ color: "var(--muted)" }}>Scarta</button>
            <button className="btn btn-primary" disabled={pending} onClick={accept}>{ACTIONS.find((a) => a[0] === act)![3]}</button>
          </div>
        </div>
      )}
    </>
  );
}

export function ContentEditor({ id, content, isLink }: { id: string; content: string; isLink: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(content);
  const [pending, start] = useTransition();
  const paras = content.split(/\n{2,}/).filter(Boolean);
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="eyebrow">Contenuto</div>
        {!editing && <button className="btn btn-ghost" onClick={() => { setValue(content); setEditing(true); }} style={{ height: 26, color: "var(--muted)" }}>Modifica</button>}
      </div>
      {editing ? (
        <>
          <textarea className="input" value={value} onChange={(e) => setValue(e.target.value)} rows={10} style={{ fontSize: 16, lineHeight: 1.7 }} autoFocus />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setEditing(false)} style={{ color: "var(--muted)" }}>Annulla</button>
            <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => { await updateContent(id, value); setEditing(false); })}>Salva</button>
          </div>
        </>
      ) : isLink && /^https?:\/\/\S+$/.test(content.trim()) ? (
        <a href={content.trim()} target="_blank" rel="noreferrer" style={{ fontSize: 16, overflowWrap: "anywhere" }}>{content.trim()}</a>
      ) : (
        paras.map((t, i) => <p key={i} style={{ margin: 0, fontSize: 16, lineHeight: 1.7, maxWidth: "68ch", textWrap: "pretty", whiteSpace: "pre-wrap" }}>{t}</p>)
      )}
    </section>
  );
}

export function ItemButtons({ id, title, markdown }: { id: string; title: string; markdown: string }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [pending, start] = useTransition();
  const exportMd = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: title.replace(/[^\w\- àèéìòù]/gi, "").slice(0, 60) + ".md" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 16, borderTop: "1px solid var(--color-divider)" }}>
      <a className="btn btn-primary" href={`/assistente?ctx=item:${id}`} style={{ justifyContent: "flex-start", gap: 8 }}><Icon name="ai" />Chiedi all&apos;IA su questo</a>
      <button className="btn btn-secondary" onClick={exportMd} style={{ justifyContent: "flex-start", gap: 8 }}><Icon name="download" />Esporta</button>
      <button className="btn btn-secondary" disabled={pending} onClick={() => start(async () => { await archive(id); location.assign("/conoscenza"); })} style={{ justifyContent: "flex-start", gap: 8 }}><Icon name="archive" />Archivia</button>
      {confirmDel ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid var(--danger)" }}>
          <span style={{ fontSize: 14 }}>Eliminare definitivamente l&apos;elemento?</span>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setConfirmDel(false)} style={{ color: "var(--muted)" }}>Annulla</button>
            <button className="btn btn-primary" disabled={pending} onClick={() => start(() => deleteItem(id))} style={{ background: "var(--danger)", borderColor: "var(--danger)" }}>Elimina</button>
          </div>
        </div>
      ) : (
        <button className="btn btn-secondary" onClick={() => setConfirmDel(true)} style={{ justifyContent: "flex-start", gap: 8, color: "var(--danger)" }}><Icon name="trash" />Elimina</button>
      )}
    </div>
  );
}

type Meta = { title: string; type: ItemType; summary: string; tags: string[]; projectId: string | null; personIds: string[] };

/** Intestazione dell'elemento con modifica di titolo, tipo, sintesi, tag, progetto e persone. */
export function MetaEditor({ id, meta, projects, people, children }: { id: string; meta: Meta; projects: { id: string; name: string }[]; people: { id: string; name: string }[]; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [m, setM] = useState(meta);
  const [tagText, setTagText] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof Meta>(k: K, v: Meta[K]) => setM((x) => ({ ...x, [k]: v }));
  const open = () => { setM(meta); setTagText(meta.tags.join(", ")); setEditing(true); };
  const save = () => start(async () => {
    await updateItemMeta(id, { ...m, tags: tagText.split(",") });
    setEditing(false);
  });

  if (!editing) return (
    <div style={{ position: "relative" }}>
      {children}
      <button className="btn btn-ghost" onClick={open} style={{ position: "absolute", top: -6, right: 0, height: 28, gap: 6, color: "var(--muted)" }}><Icon name="edit" size={14} />Modifica dettagli</button>
    </div>
  );

  const label = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 16, border: "1px solid var(--color-divider)", background: "var(--raised)" }}>
      <label style={label}><span className="muted">Titolo</span><input className="input" value={m.title} onChange={(e) => set("title", e.target.value)} autoFocus style={{ fontSize: 17 }} /></label>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label style={{ ...label, flex: "1 1 160px" }}><span className="muted">Tipo</span>
          <select className="input" value={m.type} onChange={(e) => set("type", e.target.value as ItemType)}>{ITEM_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <label style={{ ...label, flex: "1 1 200px" }}><span className="muted">Progetto</span>
          <select className="input" value={m.projectId ?? ""} onChange={(e) => set("projectId", e.target.value || null)}>
            <option value="">Nessun progetto</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <label style={label}><span className="muted">Sintesi</span><textarea className="input" rows={3} value={m.summary} onChange={(e) => set("summary", e.target.value)} /></label>
      <label style={label}><span className="muted">Tag, separati da virgola</span><input className="input" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="prezzi, lancio" /></label>
      {people.length > 0 && (
        <div style={label}>
          <span className="muted">Persone</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {people.map((p) => {
              const on = m.personIds.includes(p.id);
              return <button key={p.id} className="suggestion" aria-pressed={on} onClick={() => set("personIds", on ? m.personIds.filter((x) => x !== p.id) : [...m.personIds, p.id])}
                style={on ? { background: "var(--sel)", color: "var(--color-text)", borderColor: "var(--color-accent)" } : undefined}>{on ? "✓ " : ""}{p.name}</button>;
            })}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={() => setEditing(false)} style={{ color: "var(--muted)" }}>Annulla</button>
        <button className="btn btn-primary" disabled={pending || !m.title.trim()} onClick={save}>Salva</button>
      </div>
    </div>
  );
}
