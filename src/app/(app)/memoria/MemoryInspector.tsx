"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import { addFact, confirmFact, deleteFact, endFact, inspectorData, restoreFact, setFactCategory, updateFact, type Fact } from "@/lib/actions";
import type { FactCategory } from "@/lib/db/schema";
import { confirmedAgo, factAge } from "@/lib/fact-age";
import { FactQuestion } from "@/components/FactQuestion";

type Data = Awaited<ReturnType<typeof inspectorData>>;

const GROUPS: [FactCategory | null, string, string][] = [
  ["personale", "Personale", "Vita privata, famiglia, casa, luoghi"],
  ["lavoro", "Lavoro", "Impiego, ruolo, aziende, competenze"],
  ["persone", "Persone", "Chi sono per te le persone della tua vita"],
  ["preferenze", "Preferenze", "Gusti, abitudini, strumenti"],
  [null, "Da classificare", "L'IA li assegna a un gruppo alla prossima apertura"],
];
const CATEGORY_LABEL: Record<string, string> = { personale: "Personale", lavoro: "Lavoro", persone: "Persone", preferenze: "Preferenze" };
const SOURCE: Record<string, string> = { chat: "dall'Assistente", comando: "da un comando", manuale: "scritto da te", suggerimento: "da un suggerimento" };
const ORIGIN: Record<string, string> = { declared: "detto da te", inferred: "dedotto dall'IA", observed: "letto in un elemento" };

const dayLabel = (d: string | number) =>
  new Date(typeof d === "string" ? d + "T12:00:00" : d).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
const age = (f: Fact) => factAge(f.lastConfirmedAt, f.createdAt);
/** Forse superato: confermato da oltre sei mesi. */
const isStale = (f: Fact) => f.status === "confirmed" && age(f).age === "stale";

/** Stato del fatto: icona, colore e parola. */
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());

function status(f: Fact): [string, string, "check" | "alert" | "archive" | "calendar"] {
  if (f.status === "obsolete") return ["Non più vero", "var(--muted)", "archive"];
  if (f.status === "confirmed" && f.validFrom && f.validFrom > todayIso()) return [`In arrivo, dal ${dayLabel(f.validFrom)}`, "var(--accent-text)", "calendar"];
  if (f.status === "conflict") return ["In conflitto", "var(--danger)", "alert"];
  if (f.status === "pending") return [f.origin === "inferred" ? "Dedotto, da confermare" : "Da confermare", "#d98a1c", "alert"];
  if (isStale(f)) return ["Forse superato", "#d98a1c", "alert"];
  if (age(f).age === "old") return ["Vecchio", "#b39150", "check"];
  return ["Fresco", "var(--accent-text)", "check"];
}

export function MemoryInspector({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [text, setText] = useState("");
  const [cat, setCat] = useState<FactCategory | "">("");
  const [showPast, setShowPast] = useState(false);
  const [pending, start] = useTransition();
  const reload = async () => setData(await inspectorData());
  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); await reload(); });

  const add = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    act(() => addFact(t, "manuale", { category: cat || null }));
  };

  const facts = data.facts;
  const past = facts.filter((f) => f.status === "obsolete");
  const review = facts.filter((f) => f.status === "pending" || f.status === "conflict" || isStale(f));
  const valid = facts.filter((f) => f.status === "confirmed" && !isStale(f));

  return (
    <div className="page" style={{ maxWidth: 980, gap: 28 }}>
      <div>
        <h1 className="page-title" style={{ margin: 0, fontSize: 40 }}>Cosa so di te</h1>
        <div className="muted" style={{ fontSize: 14, maxWidth: 680 }}>
          {valid.length} {valid.length === 1 ? "fatto confermato" : "fatti confermati"}
          {review.length ? ` · ${review.length} da verificare` : ""}{past.length ? ` · ${past.length} non più ${past.length === 1 ? "vero" : "veri"}` : ""}.
          {" "}L&apos;IA usa in ogni conversazione solo i fatti confermati; quelli non più veri restano come storia. Nulla entra qui senza la tua conferma.
          {" "}Fresco: confermato negli ultimi 3 mesi · Vecchio: da 3 a 6 mesi · Forse superato: oltre 6 mesi.
        </div>
      </div>

      {data.question && <FactQuestion key={data.question.id} q={data.question} />}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Aggiungi qualcosa su di te, es. «Lavoro con Rossi sul cantiere di via Roma»" style={{ flex: "1 1 280px" }} />
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value as FactCategory | "")} aria-label="Gruppo" style={{ flex: "0 0 180px" }}>
          <option value="">Gruppo: automatico</option>
          {GROUPS.filter(([k]) => k).map(([k, label]) => <option key={k} value={k!}>{label}</option>)}
        </select>
        <button className="btn btn-primary" onClick={add} disabled={!text.trim() || pending} style={{ gap: 6 }}><Icon name="plus" size={14} />Aggiungi</button>
      </div>

      {review.length > 0 && (
        <Section title="Da verificare" desc="Fatti dedotti dall'IA, in conflitto o non confermati da più di sei mesi: dimmi se sono ancora veri." tone="warn">
          {review.map((f) => <FactRow key={f.id} f={f} act={act} />)}
        </Section>
      )}

      {!facts.length && (
        <div className="empty" style={{ padding: "56px 24px" }}>
          <span className="faint"><Icon name="user" size={20} /></span>
          <div className="empty-title" style={{ fontSize: 22 }}>Ancora niente</div>
          <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 460 }}>Racconta qualcosa di te all&apos;Assistente o nella barra dei comandi: l&apos;IA ti proporrà cosa ricordare, e lo salverà solo se confermi.</p>
        </div>
      )}

      {GROUPS.map(([k, title, desc]) => {
        const list = valid.filter((f) => f.category === k);
        if (!list.length) return null;
        return (
          <Section key={title} title={title} desc={desc} count={list.length}>
            {list.map((f) => <FactRow key={f.id} f={f} act={act} />)}
          </Section>
        );
      })}

      {data.people.length > 0 && (
        <Section title="Le persone che conosco" desc="Chi sono per te le persone nella memoria. Si modificano dalla loro scheda." count={data.people.length}>
          {data.people.map((p) => (
            <Link key={p.id} href={`/persone/${p.id}`} className="row-hover" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", borderTop: "1px solid var(--color-divider)", color: "inherit", textDecoration: "none" }}>
              <span className="faint" style={{ display: "flex" }}><Icon name="user" size={14} /></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 14 }}>{p.name}{p.role || p.org ? <span className="muted"> · {[p.role, p.org].filter(Boolean).join(" · ")}</span> : null}</span>
                {p.note && <span className="faint ellipsis" style={{ fontSize: 12 }}>{p.note}</span>}
              </span>
              <span className="faint" style={{ display: "flex" }}><Icon name="chevR" size={14} /></span>
            </Link>
          ))}
        </Section>
      )}

      {data.habits.length > 0 && (
        <Section title="Abitudini che ho notato" desc="Cose che fai con regolarità, ricavate da attività ed elementi. Il giorno prima te le ricordo nei suggerimenti." count={data.habits.length}>
          {data.habits.map((h) => (
            <div key={h.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 4px", borderTop: "1px solid var(--color-divider)" }}>
              <span className="faint" style={{ display: "flex", marginTop: 3 }}><Icon name="refresh" size={14} /></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 15 }}>{h.label}</span>
                <span className="faint" style={{ fontSize: 12, display: "flex", flexWrap: "wrap", columnGap: 6 }}>
                  <span style={{ color: "var(--accent-text)" }}>{h.rhythm}</span>
                  <span>· {h.times} volte</span>
                  <span>· prossima {h.daysToNext === 0 ? "oggi" : h.daysToNext === 1 ? "domani" : `il ${dayLabel(h.next)}`}</span>
                  {h.recent[0] && <span>· ultima: {h.recent[0].source === "item" ? <Link href={`/conoscenza/${h.recent[0].id}`} style={{ color: "inherit" }}>{h.recent[0].title}</Link> : h.recent[0].title}</span>}
                </span>
              </span>
            </div>
          ))}
        </Section>
      )}

      {past.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="link-btn muted" onClick={() => setShowPast((v) => !v)} style={{ alignSelf: "flex-start", fontSize: 13 }}>
            {showPast ? "Nascondi la storia" : `Non più veri (${past.length}): la storia che conosco ma non uso come situazione attuale`}
          </button>
          {showPast && <div style={{ display: "flex", flexDirection: "column" }}>{past.map((f) => <FactRow key={f.id} f={f} act={act} />)}</div>}
        </div>
      )}
    </div>
  );
}

function Section({ title, desc, count, tone, children }: { title: string; desc: string; count?: number; tone?: "warn"; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: tone === "warn" ? "#d98a1c" : undefined }}>{title}</h2>
        {count != null && <span className="faint" style={{ fontSize: 13 }}>{count}</span>}
        <span className="muted" style={{ fontSize: 13 }}>{desc}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>
    </section>
  );
}

/** Una riga del Memory Inspector: stato, testo modificabile, provenienza e date, azioni. */
function FactRow({ f, act }: { f: Fact; act: (fn: () => Promise<unknown>) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(f.text);
  const [draftCat, setDraftCat] = useState<FactCategory | "">(f.category ?? "");
  const [label, color, icon] = status(f);
  const obsolete = f.status === "obsolete";
  const needsReview = f.status !== "confirmed" || isStale(f);
  const btn = { height: 30, width: 30, color: "var(--muted)" };

  const save = () => {
    setEditing(false);
    act(async () => {
      if (draft.trim() !== f.text) await updateFact(f.id, draft);
      if ((draftCat || null) !== f.category) await setFactCategory(f.id, draftCat || null);
    });
  };

  const meta: ReactNode[] = [
    <span key="s" style={{ color }}>{label}</span>,
    f.origin === "declared" ? SOURCE[f.source] ?? f.source : ORIGIN[f.origin],
  ];
  if (f.origin === "inferred" && f.confidence != null) meta.push(`sicuro al ${Math.round(f.confidence * 100)}%`);
  if (f.sourceLink) meta.push(<Link key="l" href={f.sourceLink.href} style={{ color: "inherit" }}>{f.sourceLink.label}</Link>);
  if (obsolete) meta.push(f.validUntil ? `valido fino al ${dayLabel(f.validUntil)}` : "non più vero");
  // Per i fatti in arrivo la data d'inizio è già nello stato.
  else if (!(f.validFrom && f.validFrom > todayIso())) meta.push(`dal ${dayLabel(f.validFrom ?? f.createdAt)}${f.validUntil ? ` al ${dayLabel(f.validUntil)}` : ""}`);
  if (!obsolete && f.lastConfirmedAt) meta.push(<span key="c" title={`il ${dayLabel(f.lastConfirmedAt)}`}>{confirmedAgo(age(f).days)}</span>);
  if (f.supersededBy) meta.push(`sostituito da «${f.supersededBy.text}»`);

  return (
    <div className="row-hover" style={{ display: "flex", alignItems: "flex-start", flexWrap: "wrap", gap: "6px 10px", padding: "10px 4px", borderTop: "1px solid var(--color-divider)", opacity: obsolete ? 0.75 : 1 }}>
      <span style={{ color, display: "flex", marginTop: 3 }} title={label}><Icon name={icon} size={14} /></span>
      {editing ? (
        <div style={{ flex: "1 1 240px", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="input" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} style={{ flex: "1 1 260px", height: 34 }} />
          <select className="input" value={draftCat} onChange={(e) => setDraftCat(e.target.value as FactCategory | "")} aria-label="Gruppo" style={{ flex: "0 0 140px", height: 34 }}>
            <option value="">Da classificare</option>
            {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="btn btn-primary" onClick={save} style={{ height: 34 }}>Salva</button>
          <button className="btn btn-ghost" onClick={() => { setEditing(false); setDraft(f.text); setDraftCat(f.category ?? ""); }} style={{ height: 34 }}>Annulla</button>
        </div>
      ) : (
        <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 15, textDecoration: obsolete ? "line-through" : undefined, textDecorationColor: "var(--muted)" }}>{f.text}</span>
          <span className="faint" style={{ fontSize: 12, display: "flex", flexWrap: "wrap", columnGap: 6 }}>
            {meta.map((m, i) => <span key={i}>{i > 0 && "· "}{m}</span>)}
          </span>
        </div>
      )}
      {!editing && (
        <div style={{ display: "flex", gap: 2, flex: "none", marginLeft: "auto" }}>
          {obsolete ? (
            <button className="btn btn-ghost btn-icon" title="È ancora vero: ripristina" aria-label="Ripristina" onClick={() => act(() => restoreFact(f.id))} style={btn}><Icon name="refresh" size={14} /></button>
          ) : needsReview ? (
            <button className="btn btn-secondary" title="È vero" onClick={() => act(() => confirmFact(f.id))} style={{ height: 30, gap: 6, fontSize: 13 }}><Icon name="check" size={13} />Confermo</button>
          ) : (
            <button className="btn btn-ghost btn-icon" title="È ancora vero: aggiorna la data di conferma" aria-label="Conferma" onClick={() => act(() => confirmFact(f.id))} style={btn}><Icon name="check" size={14} /></button>
          )}
          {!obsolete && <button className="btn btn-ghost btn-icon" title="Modifica" aria-label="Modifica" onClick={() => setEditing(true)} style={btn}><Icon name="edit" size={14} /></button>}
          {!obsolete && <button className="btn btn-ghost btn-icon" title="Non più vero: resta come storia" aria-label="Non più vero" onClick={() => act(() => endFact(f.id))} style={btn}><Icon name="archive" size={14} /></button>}
          <button className="btn btn-ghost btn-icon" title="Rimuovi del tutto" aria-label="Rimuovi" onClick={() => { if (confirm(`Dimenticare del tutto «${f.text}»?`)) act(() => deleteFact(f.id)); }} style={btn}><Icon name="x" size={14} /></button>
        </div>
      )}
    </div>
  );
}
