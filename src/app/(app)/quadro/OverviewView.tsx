"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Blueprint, Icon } from "@/components/ui";
import type { IconName } from "@/lib/icons";
import { addTask, makeOverview, removeOverview } from "@/lib/actions";
import type { Overview, OverviewPoint } from "@/lib/overview";
import { overviewHref } from "@/lib/overview-topic";

type Recent = { topic: string; title: string; at: number; kind: Overview["scope"]["kind"] };

const KIND: Record<Overview["scope"]["kind"], string> = { project: "Progetto", person: "Persona", aim: "Obiettivo", tag: "Tag", search: "Argomento" };
const when = (ms: number) => new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(ms);

/** Quadro completo di un argomento: vista derivata dalla memoria, con le fonti di ogni punto. Non si salva in memoria. */
export function OverviewView({ topic, initial, stale, recent, suggestions, aiOn }: {
  topic: string; initial: Overview | null; stale: boolean; recent: Recent[]; suggestions: string[]; aiOn: boolean;
}) {
  const [ov, setOv] = useState(initial);
  const [isStale, setStale] = useState(stale);
  const [text, setText] = useState(topic);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const auto = useRef(false);

  const generate = () => {
    setError(null);
    start(async () => {
      const r = await makeOverview(topic);
      if ("error" in r) setError(r.error); else { setOv(r); setStale(false); }
    });
  };
  // Aperto con un argomento mai visto (dall'Assistente, dalla barra comandi o da un pulsante): si genera subito.
  useEffect(() => {
    if (topic && !initial && aiOn && !auto.current) { auto.current = true; generate(); }
  }, [topic, initial, aiOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (t: string) => { const v = t.trim(); if (v) router.push(overviewHref(v)); };

  return (
    <div className="page ov" style={{ maxWidth: 1100, gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h1 className="page-title" style={{ margin: 0, fontSize: 40 }}>Quadro completo</h1>
          <div className="muted" style={{ fontSize: 14, maxWidth: 640 }}>Tutto quello che la memoria sa di un argomento, messo in ordine: stato, decisioni, problemi, persone, contraddizioni e prossimi passi, con le fonti. Non viene salvato in memoria.</div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); open(text); }} style={{ display: "flex", gap: 8, maxWidth: 640 }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Un progetto, una persona, un obiettivo, un #tag o un argomento" aria-label="Argomento" style={{ flex: 1, fontSize: 15 }} />
          <button className="btn btn-primary" disabled={!text.trim() || pending} style={{ gap: 6 }}><Icon name="ai" size={14} />Quadro</button>
        </form>
      </div>

      {!topic ? (
        <Start recent={recent} suggestions={suggestions} aiOn={aiOn} open={open} />
      ) : pending && !ov ? (
        <Blueprint style={{ padding: 28, display: "flex", gap: 12, alignItems: "center" }}>
          <span className="spin" /><span className="muted">Raccolgo quello che la memoria sa su «{topic}» e lo metto in ordine…</span>
        </Blueprint>
      ) : ov ? (
        <View ov={ov} stale={isStale} pending={pending} onRefresh={generate} aiOn={aiOn} />
      ) : !aiOn ? (
        <div className="muted">Imposta la chiave OpenRouter nelle Impostazioni per generare il quadro.</div>
      ) : null}

      {error && <div className="alert"><Icon name="alert" style={{ color: "var(--danger)" }} /><span style={{ flex: 1 }}>{error}</span><button className="btn btn-secondary" onClick={generate}>Riprova</button></div>}
    </div>
  );
}

function Start({ recent, suggestions, aiOn, open }: { recent: Recent[]; suggestions: string[]; aiOn: boolean; open: (t: string) => void }) {
  const [list, setList] = useState(recent);
  const [, start] = useTransition();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {suggestions.length > 0 && aiOn && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="eyebrow">Prova con</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {suggestions.map((s) => <button key={s} className="nw-topic" onClick={() => open(s)} style={{ cursor: "pointer", border: 0 }}>{s}</button>)}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>Puoi chiederlo anche all&apos;Assistente o con ⌘J: «fammi il quadro completo di …».</div>
        </section>
      )}
      {list.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column" }}>
          <div className="eyebrow" style={{ paddingBottom: 8 }}>Quadri recenti</div>
          {list.map((r) => (
            <div key={r.topic} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto 28px", gap: 12, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--color-divider)" }}>
              <Link href={overviewHref(r.topic)} style={{ color: "inherit", textDecoration: "none", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 15 }}>{r.title}</span>
                <span className="muted" style={{ fontSize: 12 }}>{KIND[r.kind]} · {when(r.at)}</span>
              </Link>
              <span />
              <button className="btn btn-ghost" aria-label={`Togli ${r.title}`} title="Togli dai recenti" onClick={() => { setList((l) => l.filter((x) => x.topic !== r.topic)); start(() => removeOverview(r.topic)); }}
                style={{ height: 28, width: 28, padding: 0, justifyContent: "center", color: "var(--muted)" }}><Icon name="x" size={13} /></button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function View({ ov, stale, pending, onRefresh, aiOn }: { ov: Overview; stale: boolean; pending: boolean; onRefresh: () => void; aiOn: boolean }) {
  // Numero di ogni fonte, nell'ordine della lista in fondo.
  const num = new Map(ov.sources.map((s, i) => [s.id, i + 1]));
  const refs = (ids: string[]) => ids.length ? (
    <span className="ov-refs">{ids.map((id) => num.has(id) && (
      <Link key={id} href={`/conoscenza/${id}`} title={ov.sources[num.get(id)! - 1].title} className="cite">{num.get(id)}</Link>
    ))}</span>
  ) : null;
  const list = (items: OverviewPoint[]) => <ul className="ov-list">{items.map((p, i) => <li key={i}>{p.text}{refs(p.refs)}</li>)}</ul>;
  const ask = `Approfondiamo il quadro di «${ov.title}»: cosa dovrei fare adesso e perché?`;

  return (
    <article style={{ display: "flex", flexDirection: "column", gap: 26, opacity: pending ? 0.55 : 1, transition: "opacity .2s" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-text)" }}>
          <Icon name="ai" size={13} />{KIND[ov.scope.kind]}
          {ov.scope.href && <Link href={ov.scope.href} style={{ color: "inherit", textTransform: "none", letterSpacing: 0 }}>· apri {ov.scope.label}</Link>}
        </div>
        <h2 className="page-title" style={{ margin: 0, fontSize: 36 }}>{ov.title}</h2>
        <p style={{ margin: 0, fontSize: 18, lineHeight: 1.55, textWrap: "pretty", maxWidth: 820 }}>{ov.summary}</p>
      </header>

      <div className="ov-grid">
        {ov.goal && <Section icon="target" title="Obiettivo"><p>{ov.goal}</p></Section>}
        {ov.status && <Section icon="timeline" title="Stato"><p>{ov.status}</p></Section>}
        {ov.decisions.length > 0 && <Section icon="decision" title="Decisioni prese">{list(ov.decisions)}</Section>}
        {ov.problems.length > 0 && <Section icon="alert" title="Problemi aperti">{list(ov.problems)}</Section>}
        {ov.people.length > 0 && (
          <Section icon="users" title="Persone">
            <ul className="ov-list">
              {ov.people.map((p, i) => (
                <li key={i}>
                  {p.personId ? <Link href={`/persone/${p.personId}`} style={{ color: "inherit", fontWeight: 500 }}>{p.name}</Link> : <b style={{ fontWeight: 500 }}>{p.name}</b>}
                  {p.role && <> — {p.role}</>}{refs(p.refs)}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {ov.contradictions.length > 0 && <Section icon="link" title="Contraddizioni" tone="danger">{list(ov.contradictions)}</Section>}
      </div>

      {ov.nextSteps.length > 0 && (
        <Section icon="tasks" title="Prossimi passi">
          <div style={{ display: "flex", flexDirection: "column" }}>
            {ov.nextSteps.map((p, i) => <Step key={i} p={p} refs={refs(p.refs)} scope={ov.scope} />)}
          </div>
        </Section>
      )}

      {ov.sources.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="eyebrow">Fonti · {ov.sources.length}</div>
          <ol className="ov-sources">
            {ov.sources.map((s) => (
              <li key={s.id}><Link href={`/conoscenza/${s.id}`}>{s.title}</Link> <span className="muted">· {s.type ?? "Nota"} · {s.date.split("-").reverse().join("/")}</span></li>
            ))}
          </ol>
        </section>
      )}

      <footer style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", paddingTop: 12, borderTop: "1px solid var(--color-divider)" }}>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Preparato il {when(ov.at)} da {ov.counts.items} elementi e {ov.counts.tasks} attività · non salvato in memoria
          {stale && <> · <span style={{ color: "var(--accent-text)" }}>ci sono novità da allora</span></>}
        </span>
        <span style={{ flex: 1 }} />
        {aiOn && <button className={stale ? "btn btn-secondary" : "btn btn-ghost"} onClick={onRefresh} disabled={pending} style={{ gap: 6 }}>{pending ? <span className="spin" /> : <Icon name="refresh" size={14} />}Aggiorna</button>}
        <Link href={`/assistente?q=${encodeURIComponent(ask)}`} className="btn btn-ghost" style={{ gap: 6 }}><Icon name="ai" size={14} />Approfondisci con l&apos;Assistente</Link>
      </footer>
    </article>
  );
}

function Section({ icon, title, tone, children }: { icon: IconName; title: string; tone?: "danger"; children: ReactNode }) {
  return (
    <section className="ov-sec">
      <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, color: tone === "danger" ? "var(--danger)" : undefined }}><Icon name={icon} size={13} />{title}</div>
      {children}
    </section>
  );
}

/** Un prossimo passo, che si può aggiungere alle attività (nel progetto o nell'obiettivo del quadro). */
function Step({ p, refs, scope }: { p: OverviewPoint; refs: ReactNode; scope: Overview["scope"] }) {
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [, start] = useTransition();
  const add = () => {
    setState("saving");
    start(async () => {
      await addTask(p.text, { projectId: scope.kind === "project" ? scope.id : null, aimId: scope.kind === "aim" ? scope.id : null });
      setState("done");
    });
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "9px 0", borderTop: "1px solid var(--color-divider)" }}>
      <span style={{ fontSize: 15, lineHeight: 1.5 }}>{p.text}{refs}</span>
      {p.taskId
        ? <Link href="/attivita" className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}><Icon name="tasks" size={13} />Già in attività</Link>
        : state === "done"
        ? <span style={{ fontSize: 13, color: "var(--accent-text)", display: "flex", alignItems: "center", gap: 4 }}><Icon name="check" size={13} />In attività</span>
        : <button className="btn btn-ghost" onClick={add} disabled={state === "saving"} style={{ gap: 6, height: 30, color: "var(--accent-text)" }}><Icon name="plus" size={13} />Attività</button>}
    </div>
  );
}
