"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import { generateBrief, type SavedBrief } from "@/lib/actions";

const TITLE = { project: "Cosa dovresti sapere", person: "Relazione in breve" } as const;

/** Sintesi IA di un progetto o di una persona: generata su richiesta, salvata, segnalata come superata se la memoria è cambiata. */
export function BriefCard({ kind, id, initial, count, aiOn }: { kind: "project" | "person"; id: string; initial: SavedBrief | null; count: number; aiOn: boolean }) {
  const [brief, setBrief] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stale = !!brief && brief.count !== count;

  const run = () => {
    setError(null);
    start(async () => {
      const res = await generateBrief(kind, id);
      if ("error" in res) setError(res.error); else setBrief(res);
    });
  };
  const when = brief && new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(brief.at);

  return (
    <div className="blueprint" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
      <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent-text)" }}><Icon name="ai" size={14} />{TITLE[kind]}</div>

      {pending ? (
        <div className="muted" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><span className="spin" />Leggo la memoria…</div>
      ) : brief ? (
        <>
          {brief.paragraphs.map((t, i) => <p key={i} style={{ margin: 0, fontSize: 15, lineHeight: 1.55, textWrap: "pretty" }}>{t}</p>)}
          {brief.points.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: 14, lineHeight: 1.5 }}>
              {brief.points.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            Aggiornata il {when}{stale && <> · <span style={{ color: "var(--accent-text)" }}>ci sono novità da allora</span></>}
          </span>
        </>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          {aiOn ? (kind === "project" ? "Una sintesi del progetto dai documenti, dalle decisioni e dalle attività in memoria." : "Una sintesi di chi è questa persona per te e di cosa avete in sospeso.") : "Imposta la chiave OpenRouter nelle Impostazioni per generare la sintesi."}
        </p>
      )}

      {error && <div className="alert"><Icon name="alert" style={{ color: "var(--danger)" }} /><span style={{ flex: 1 }}>{error}</span></div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {aiOn && (
          <button className={brief && !stale ? "btn btn-ghost" : "btn btn-secondary"} onClick={run} disabled={pending} style={{ gap: 6 }}>
            <Icon name={brief ? "refresh" : "ai"} size={14} />{brief ? "Aggiorna" : "Genera"}
          </button>
        )}
        <Link href={`/assistente?ambito=${kind}:${id}`} className="btn btn-ghost" style={{ paddingLeft: brief || !aiOn ? 0 : undefined }}>Approfondisci con l'assistente</Link>
      </div>
    </div>
  );
}
