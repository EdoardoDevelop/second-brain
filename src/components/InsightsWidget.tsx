"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import type { IconName } from "@/lib/icons";
import { ActionCard } from "@/components/CommandBar";
import { completeInsight, dismissInsight, runMorningRound } from "@/lib/actions";
import type { CommandAction } from "@/lib/ai";

type Insight = { id: string; kind: string; title: string; body: string; actions: CommandAction[]; names: Record<string, string>; refs: { id: string; title: string; href: string }[] };

const KIND: Record<string, [string, IconName]> = {
  project: ["Nuovo progetto?", "folder"],
  follow_up: ["Da risentire", "user"],
  stale: ["Progetto fermo", "timeline"],
  overdue: ["In ritardo", "alert"],
  conflict: ["Da chiarire", "link"],
  weekly: ["La tua settimana", "calendar"],
  cleanup: ["Da riordinare", "archive"],
  other: ["Suggerimento", "ai"],
};

/** Suggerimenti dell'IA nella Home: ognuno si può rivedere (azioni da confermare) o ignorare. */
export function InsightsWidget({ items, aiOn }: { items: Insight[]; aiOn: boolean }) {
  const [list, setList] = useState(items);
  // Suggerimenti nuovi dal server (dopo «Aggiorna» o il giro del mattino).
  useEffect(() => setList(items), [items]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const generate = () => start(async () => {
    setError(null);
    const r = await runMorningRound();
    if ("error" in r) setError(r.error);
  });

  if (!aiOn) return <div className="muted" style={{ fontSize: 14, padding: "12px 0" }}>Serve la chiave OpenRouter (Impostazioni → IA) per i suggerimenti.</div>;
  return (
    <div className="ins" data-busy={pending || undefined}>
      {list.length ? (
        <div className="ins-grid">
          {list.map((x, k) => <Card key={x.id} x={x} k={k} onGone={() => setList((l) => l.filter((y) => y.id !== x.id))} />)}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 14, padding: "8px 0" }}>
          Nessun suggerimento per ora. Ogni mattina l&apos;IA guarda la memoria e propone cosa fare.
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-ghost" onClick={generate} disabled={pending} style={{ gap: 6, height: 30, color: "var(--accent-text)" }}>
          <span className="nw-spin" style={{ display: "flex" }}><Icon name="refresh" size={14} /></span>{pending ? "L'IA sta guardando la memoria…" : "Aggiorna suggerimenti"}
        </button>
        {error && <span style={{ fontSize: 13, color: "var(--danger)" }}>{error}</span>}
      </div>
    </div>
  );
}

function Card({ x, k, onGone }: { x: Insight; k: number; onGone: () => void }) {
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState(x.actions.map((a) => ({ ...a, on: true })));
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [, start] = useTransition();
  const [label, icon] = KIND[x.kind] ?? KIND.other;
  const chosen = cards.filter((c) => c.on).map(({ on: _on, ...a }) => a);

  const accept = () => {
    setState("saving");
    start(async () => { await completeInsight(x.id, chosen); setState("done"); setTimeout(onGone, 1400); });
  };
  const dismiss = () => { onGone(); start(() => dismissInsight(x.id)); };

  return (
    <article className="ins-card" style={{ animationDelay: `${k * 70}ms` }} data-done={state === "done" || undefined}>
      <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent-text)" }}><Icon name={icon} size={13} />{label}</div>
      <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>{x.title}</div>
      {x.body && <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{x.body}</div>}
      {x.refs.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {x.refs.map((r) => <Link key={r.id} href={r.href} className="nw-topic" style={{ textDecoration: "none" }}>{r.title}</Link>)}
        </div>
      )}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cards.map((c, i) => <ActionCard key={i} a={c} names={x.names} onChange={(p) => setCards((l) => l.map((y, j) => (j === i ? { ...y, ...p } : y)))} />)}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: "auto", paddingTop: 4 }}>
        {state === "done" ? (
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--accent-text)" }}><Icon name="check" size={14} />Fatto</span>
        ) : x.actions.length ? (
          open
            ? <button className="btn btn-primary" onClick={accept} disabled={state === "saving" || !chosen.length} style={{ height: 30 }}>{state === "saving" ? "Salvo…" : chosen.length === 1 ? "Conferma" : `Conferma ${chosen.length} azioni`}</button>
            : <button className="btn btn-secondary" onClick={() => setOpen(true)} style={{ height: 30, gap: 6 }}><Icon name="ai" size={13} />Rivedi {x.actions.length === 1 ? "l'azione" : `${x.actions.length} azioni`}</button>
        ) : (
          <button className="btn btn-secondary" onClick={accept} style={{ height: 30, gap: 6 }}><Icon name="check" size={13} />Ok, visto</button>
        )}
        {state !== "done" && <button className="btn btn-ghost" onClick={dismiss} style={{ height: 30, color: "var(--muted)" }}>Ignora</button>}
      </div>
    </article>
  );
}
