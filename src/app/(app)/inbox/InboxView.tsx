"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Blueprint, Icon, itemIcon, KIND_ICON, Spinner } from "@/components/ui";
import { archive, capture, confirm, discard, retry, saveRaw } from "@/lib/actions";
import { fmtSeconds, useRecorder } from "@/components/useRecorder";
import { ITEM_TYPES, type ItemKind, type ItemStatus, type ItemType, type Proposal } from "@/lib/db/schema";

type Row = { id: string; kind: ItemKind; status: ItemStatus; title: string; content: string; source: string; time: string; error: string | null; proposal: Proposal | null };
type Props = {
  aiOn: boolean;
  items: Row[];
  projects: { id: string; name: string }[];
  memory: Record<string, { title: string; meta: string; type: ItemType | null; kind: ItemKind }>;
};

const MAX_MB = 20;
const ACCEPT = "image/*,application/pdf,audio/*";
const FILE_STEPS = ["Carico il file", "Leggo il contenuto con l'IA", "Riconosco persone, progetti e collegamenti"];
const STEPS = ["Leggo il contenuto", "Riconosco persone, progetti e argomenti", "Cerco collegamenti nella memoria"];
const TABS: [string, ItemKind[] | null][] = [["Tutto", null], ["Note", ["note"]], ["Link", ["link"]], ["File", ["file"]], ["Audio", ["audio"]]];
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

export function InboxView({ aiOn, items, projects, memory }: Props) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "processing">("idle");
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState<{ id: string; content: string; p: Proposal } | null>(null);
  const [tab, setTab] = useState("Tutto");
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [fileSteps, setFileSteps] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Arrivo dal «Condividi» del telefono: avviso e pulizia dell'indirizzo.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const shared = q.get("condiviso");
    if (!shared) return;
    setToast(shared === "errore" ? "Condivisione non riuscita" + (q.get("msg") ? ": " + q.get("msg") : ".") : "Ricevuto: lo sto elaborando, la proposta comparirà qui.");
    history.replaceState(null, "", "/inbox");
  }, []);

  // Elementi in elaborazione in background (per esempio condivisi): si aggiorna finché non sono pronti.
  const busyInBackground = items.some((i) => i.status === "processing");
  useEffect(() => {
    if (!busyInBackground || phase === "processing") return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [busyInBackground, phase, router]);

  const upload = async (file: File) => {
    if (phase === "processing") return;
    if (file.size > MAX_MB * 1024 * 1024) { setToast(`File troppo grande: il massimo è ${MAX_MB} MB.`); return; }
    setPhase("processing"); setFileSteps(true); setStep(0); setEditing(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("note", text.trim());
      const res = await fetch("/api/capture-file", { method: "POST", body });
      const row = await res.json().catch(() => ({ error: "Risposta non valida dal server." }));
      if (!res.ok) { setToast(row.error ?? "Caricamento non riuscito."); return; }
      setText("");
      if (row.status === "ready" && row.proposal) setEditing({ id: row.id, content: row.content, p: row.proposal });
      else if (row.status === "error") setToast("Elaborazione non riuscita: " + (row.error ?? "errore") + ". Puoi riprovare dalla lista.");
      router.refresh();
    } catch {
      setToast("Caricamento non riuscito: connessione assente.");
    } finally {
      setPhase("idle"); setFileSteps(false);
    }
  };

  const recorder = useRecorder(
    (wav) => {
      const bytes = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0));
      const stamp = new Date().toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/[/:,]/g, "-").replace(/\s+/g, "");
      upload(new File([bytes], `Nota vocale ${stamp}.wav`, { type: "audio/wav" }));
    },
    (msg) => setToast(msg),
  );

  useEffect(() => {
    if (phase !== "processing") return;
    const t = fileSteps
      ? [setTimeout(() => setStep(1), 900), setTimeout(() => setStep(2), 7000)]
      : [setTimeout(() => setStep(1), 700), setTimeout(() => setStep(2), 1600)];
    return () => t.forEach(clearTimeout);
  }, [phase, fileSteps]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const doCapture = (value = text, kind?: ItemKind) => {
    const v = value.trim();
    if (!v || phase === "processing") return;
    setPhase("processing");
    setStep(0);
    setEditing(null);
    start(async () => {
      const row = await capture({ text: v, kind: kind ?? (isUrl(v) ? "link" : "note"), source: isUrl(v) ? "Link" : "Cattura rapida" });
      setPhase("idle");
      setText("");
      if (row?.status === "ready" && row.proposal) setEditing({ id: row.id, content: row.content, p: row.proposal });
      else if (row?.status === "error") setToast("Elaborazione non riuscita: " + (row.error ?? "errore") + ". Puoi riprovare dalla lista.");
    });
  };

  const addLink = () => {
    const url = window.prompt("Incolla un link");
    if (url && url.trim()) doCapture(url.trim(), "link");
  };

  const finish = (fn: () => Promise<void>, msg: string) => {
    start(async () => {
      await fn();
      setEditing(null);
      setToast(msg);
    });
  };

  const review = (r: Row) => {
    if (!r.proposal) return;
    setEditing({ id: r.id, content: r.content, p: structuredClone(r.proposal) });
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const kinds = TABS.find(([l]) => l === tab)![1];
  const visible = items.filter((i) => !kinds || kinds.includes(i.kind));

  return (
    <div ref={topRef} className="page" style={{ maxWidth: 980, gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 className="page-title" style={{ margin: 0, fontSize: 40 }}>Inbox</h1>
        <p className="muted" style={{ margin: 0, fontSize: 15 }}>Cattura tutto. Decidi tu cosa entra nella memoria.</p>
      </div>

      {!aiOn && (
        <div className="alert" style={{ borderColor: "var(--color-divider)", background: "var(--hover)" }}>
          <Icon name="ai" style={{ color: "var(--accent-text)" }} />
          <span style={{ flex: 1 }}>IA non configurata: le catture arrivano senza classificazione e le compili tu. Imposta <code>OPENROUTER_API_KEY</code> per attivarla.</span>
        </div>
      )}

      <div
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
      >
      <Blueprint style={{ display: "flex", flexDirection: "column", outline: dragOver ? "2px dashed var(--color-accent)" : undefined, outlineOffset: -2 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); doCapture(); } }}
          placeholder={recorder.recording ? "Sto registrando… premi Stop per finire" : "Cattura qualcosa… un'idea, un link, oppure trascina qui una foto, un PDF o un audio"}
          rows={3}
          style={{ width: "100%", border: 0, background: "transparent", color: "var(--color-text)", font: "inherit", fontSize: 20, lineHeight: 1.5, padding: "22px 24px 8px", resize: "none", outline: "none" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px 12px", borderTop: "1px solid var(--color-divider)", flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={addLink} disabled={phase === "processing"} style={{ gap: 6, color: "var(--muted)" }}><Icon name="link" />Link</button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={phase === "processing" || recorder.recording} style={{ gap: 6, color: "var(--muted)" }}><Icon name="file" />File</button>
          <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          {recorder.recording ? (
            <button className="btn btn-ghost" onClick={recorder.stop} style={{ gap: 8, color: "var(--danger)" }}><span className="rec-dot" />Stop · {fmtSeconds(recorder.seconds)}</button>
          ) : (
            <button className="btn btn-ghost" onClick={recorder.start} disabled={phase === "processing"} style={{ gap: 6, color: "var(--muted)" }}><Icon name="mic" />Registra</button>
          )}
          <span style={{ flex: 1 }} />
          <span className="kbd hide-mobile">⌘↵</span>
          <button className="btn btn-primary" onClick={() => doCapture()} disabled={!text.trim() || phase === "processing"} style={{ height: 34 }}>Cattura</button>
        </div>
      </Blueprint>
      </div>

      {phase === "processing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "20px 24px", border: "1px solid var(--color-divider)", animation: "sbIn .2s ease" }}>
          <div className="eyebrow">Elaborazione IA</div>
          {(fileSteps ? (aiOn ? FILE_STEPS : ["Carico il file"]) : aiOn ? STEPS : ["Salvo in Inbox"]).map((t, i) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: i < step ? "var(--muted)" : i === step ? "var(--color-text)" : "var(--faint)" }}>
              {i < step ? <Icon name="check" size={14} /> : i === step ? <Spinner /> : <span style={{ width: 5, height: 5, margin: 4.5, background: "var(--faint)", display: "block" }} />}
              {t}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ProposalEditor
          key={editing.id}
          content={editing.content}
          proposal={editing.p}
          onChange={(p) => setEditing({ ...editing, p })}
          projects={projects}
          memory={memory}
          busy={pending}
          onDiscard={() => finish(() => discard(editing.id), "Cattura scartata")}
          onSaveRaw={() => finish(() => saveRaw(editing.id), "Salvato in Conoscenza senza classificazione")}
          onConfirm={() => finish(() => confirm(editing.id, editing.p), "Salvato in Conoscenza")}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 22, flex: 1 }}>Da rivedere <span className="muted" style={{ fontWeight: 400 }}>{items.length}</span></h3>
          <div className="seg-sb">
            {TABS.map(([l]) => <button key={l} aria-pressed={tab === l} onClick={() => setTab(l)}>{l}</button>)}
          </div>
        </div>
        {items.length ? (
          <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--color-divider)" }}>
            {visible.map((it) => (
              <div key={it.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr) auto", gap: 16, alignItems: "center", padding: "14px 12px", borderBottom: "1px solid var(--color-divider)", background: editing?.id === it.id ? "var(--sel)" : undefined }}>
                <span className="muted"><Icon name={KIND_ICON[it.kind]} size={20} /></span>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 15, overflowWrap: "anywhere" }}>{it.proposal?.title || it.title}</span>
                  <span className="muted" style={{ fontSize: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span>{it.time}</span><span>·</span><span>{it.source}</span>
                    {it.status === "ready" && <><span>·</span><span style={{ color: "var(--accent-text)" }}>Proposta pronta</span></>}
                    {it.status === "processing" && <><span>·</span><span style={{ animation: "sbPulse 1.4s infinite" }}>In elaborazione…</span></>}
                    {it.status === "error" && <><span>·</span><span style={{ color: "var(--danger)" }}>{it.error}</span></>}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {it.status === "ready" && <button className="btn btn-secondary" onClick={() => review(it)} style={{ height: 30 }}>Rivedi</button>}
                  {it.status !== "ready" && (
                    <button className="btn btn-secondary" disabled={pending} onClick={() => start(() => retry(it.id))} style={{ height: 30, gap: 6 }}><Icon name="refresh" />Riprova</button>
                  )}
                  <button className="btn btn-ghost btn-icon" title="Archivia" onClick={() => start(() => archive(it.id))} style={{ width: 30, height: 30, color: "var(--muted)" }}><Icon name="archive" /></button>
                </div>
              </div>
            ))}
            {!visible.length && <div className="muted" style={{ padding: 32, textAlign: "center", fontSize: 14 }}>Nessun elemento di questo tipo.</div>}
          </div>
        ) : (
          <div className="empty">
            <span className="faint"><Icon name="inbox" size={20} /></span>
            <div className="empty-title">Inbox vuota</div>
            <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 380 }}>Tutto ciò che catturi arriva qui prima di entrare nella memoria.</p>
          </div>
        )}
      </div>

      {toast && (
        <div className="toast">
          <Icon name="check" style={{ color: "var(--accent-text)" }} />
          <span>{toast}</span>
          {toast.startsWith("Salvato") && <Link href="/conoscenza" style={{ fontSize: 13 }}>Apri</Link>}
        </div>
      )}
    </div>
  );
}

function ProposalEditor({ content, proposal: p, onChange, projects, memory, busy, onDiscard, onSaveRaw, onConfirm }: {
  content: string;
  proposal: Proposal;
  onChange: (p: Proposal) => void;
  projects: Props["projects"];
  memory: Props["memory"];
  busy: boolean;
  onDiscard: () => void;
  onSaveRaw: () => void;
  onConfirm: () => void;
}) {
  const [tagInput, setTagInput] = useState("");
  const [personInput, setPersonInput] = useState("");
  const set = (patch: Partial<Proposal>) => onChange({ ...p, ...patch });
  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "").toLowerCase();
    if (t && !p.tags.includes(t)) set({ tags: [...p.tags, t] });
    setTagInput("");
  };
  const addPerson = () => {
    const n = personInput.trim();
    if (n && !p.people.includes(n)) set({ people: [...p.people, n] });
    setPersonInput("");
  };
  const chipInput = { height: 26, border: "1px dashed var(--color-divider)", background: "none", color: "var(--color-text)", font: "inherit", fontSize: 13, padding: "0 8px", outline: "none" } as const;

  return (
    <Blueprint style={{ display: "flex", flexDirection: "column", animation: "sbIn .25s ease" }}>
      <div style={{ padding: "20px 24px 16px", display: "flex", flexDirection: "column", gap: 6, borderBottom: "1px solid var(--color-divider)" }}>
        <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-text)" }}><Icon name="ai" />Proposta · da confermare</div>
        <h3 style={{ margin: 0, fontSize: 24 }}>Ho capito questo contenuto come:</h3>
        <p className="muted" style={{ margin: 0, fontSize: 14, textWrap: "pretty", overflowWrap: "anywhere" }}>“{content.length > 400 ? content.slice(0, 400) + "…" : content}”</p>
      </div>
      <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
        <div style={{ padding: "18px 24px", display: "grid", gridTemplateColumns: "100px minmax(0,1fr)", gap: "14px 16px", alignItems: "center", fontSize: 14, borderRight: "1px solid var(--color-divider)" }}>
          <span className="muted">Tipo</span>
          <div className="seg-sb">
            {ITEM_TYPES.map((t) => <button key={t} aria-pressed={p.type === t} onClick={() => set({ type: t })}>{t}</button>)}
          </div>
          <span className="muted">Titolo</span>
          <input className="input" value={p.title} onChange={(e) => set({ title: e.target.value })} style={{ minHeight: 30, height: 30, padding: "4px 8px", fontSize: 14 }} />
          <span className="muted">Sintesi</span>
          <textarea className="input" value={p.summary} onChange={(e) => set({ summary: e.target.value })} rows={2} style={{ minHeight: 52, padding: "4px 8px", fontSize: 14, resize: "vertical" }} />
          <span className="muted">Persone</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {p.people.map((n) => (
              <span key={n} className="chip" style={{ background: "var(--hover)" }}>{n}<button onClick={() => set({ people: p.people.filter((x) => x !== n) })} className="muted"><Icon name="x" size={12} /></button></span>
            ))}
            <input value={personInput} onChange={(e) => setPersonInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPerson(); } }} onBlur={addPerson} placeholder="+ Aggiungi" style={{ ...chipInput, width: 100 }} />
          </div>
          <span className="muted">Progetto</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[{ id: null as string | null, name: "Nessuno" }, ...projects].map((o) => (
              <button key={o.id ?? "none"} onClick={() => set({ projectId: o.id })} style={{ height: 26, padding: "0 9px", border: "1px solid var(--color-divider)", background: p.projectId === o.id ? "var(--color-accent)" : "transparent", color: p.projectId === o.id ? "var(--color-bg)" : "var(--muted)", font: "inherit", fontSize: 13, cursor: "pointer" }}>{o.name}</button>
            ))}
          </div>
          <span className="muted">Tag</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {p.tags.map((t) => (
              <span key={t} className="chip" style={{ background: "var(--sel)", color: "var(--accent-text)" }}>#{t}<button onClick={() => set({ tags: p.tags.filter((x) => x !== t) })}><Icon name="x" size={12} /></button></span>
            ))}
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} onBlur={addTag} placeholder="+ tag" style={{ ...chipInput, width: 80 }} />
          </div>
        </div>
        <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="eyebrow">Collegamenti trovati</div>
          {p.links.length ? p.links.map((l) => {
            const m = memory[l.id];
            if (!m) return null;
            return (
              <div key={l.id} style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr) auto", gap: 10, padding: "8px 0", borderTop: "1px solid var(--color-divider)" }}>
                <span className="muted" style={{ paddingTop: 2 }}><Icon name={itemIcon(m.type, m.kind)} /></span>
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.35 }}>
                  <Link href={`/conoscenza/${l.id}`} style={{ fontSize: 14, color: "inherit", textDecoration: "none" }}>{m.title}</Link>
                  <span className="muted" style={{ fontSize: 12 }}>{m.meta}</span>
                  {l.conflict && <span style={{ fontSize: 12, color: "var(--danger)", marginTop: 3 }}>Possibile contraddizione{l.reason ? ": " + l.reason : ""}</span>}
                </span>
                <button className="btn btn-ghost btn-icon" title="Rimuovi collegamento" onClick={() => set({ links: p.links.filter((x) => x.id !== l.id) })} style={{ width: 24, height: 24, color: "var(--muted)" }}><Icon name="x" size={12} /></button>
              </div>
            );
          }) : <div className="muted" style={{ fontSize: 13 }}>Nessun collegamento trovato.</div>}
          {p.tasks.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginTop: 10 }}>Attività da creare</div>
              {p.tasks.map((t) => (
                <div key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--color-divider)" }}>
                  <span style={{ flex: 1 }}>{t}</span>
                  <button className="btn btn-ghost btn-icon" title="Non creare" onClick={() => set({ tasks: p.tasks.filter((x) => x !== t) })} style={{ width: 24, height: 24, color: "var(--muted)" }}><Icon name="x" size={12} /></button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 24px", borderTop: "1px solid var(--color-divider)", flexWrap: "wrap" }}>
        <span className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flex: 1, minWidth: 220 }}><Icon name="shield" />Nulla entra nella memoria finché non confermi.</span>
        <button className="btn btn-ghost" disabled={busy} onClick={onDiscard} style={{ color: "var(--muted)" }}>Scarta</button>
        <button className="btn btn-secondary" disabled={busy} onClick={onSaveRaw}>Salva senza classificazione</button>
        <button className="btn btn-primary" disabled={busy} onClick={onConfirm} style={{ gap: 6 }}><Icon name="check" />Conferma e salva</button>
      </div>
    </Blueprint>
  );
}
