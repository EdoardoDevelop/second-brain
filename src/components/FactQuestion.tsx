"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import { answerFactQuestion } from "@/lib/actions";
import { confirmedAgo } from "@/lib/fact-age";

/** «È ancora vero che…?»: la domanda del giorno su un fatto vecchio. Sì lo riconferma, No lo chiude come storia. */
export function FactQuestion({ q, compact }: { q: { id: string; text: string; days: number }; compact?: boolean }) {
  const [state, setState] = useState<"ask" | "yes" | "no" | "later">("ask");
  const [, start] = useTransition();
  const answer = (a: "yes" | "no" | "later") => { setState(a); start(() => answerFactQuestion(q.id, a)); };
  if (state === "later") return null;
  return (
    <div className="fact-q" data-compact={compact || undefined}>
      <span className="fact-q-icon"><Icon name="user" size={14} /></span>
      <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {state === "ask" ? (
          <>
            <span style={{ fontSize: 14.5 }}>È ancora vero che <b style={{ fontWeight: 500 }}>{q.text.replace(/\.$/, "")}</b>?</span>
            <span className="faint" style={{ fontSize: 12 }}>{confirmedAgo(q.days)} · <Link href="/memoria" style={{ color: "inherit" }}>Cosa so di te</Link></span>
          </>
        ) : (
          <span className="muted" style={{ fontSize: 14 }}>
            <Icon name="check" size={13} /> {state === "yes" ? "Grazie, lo tengo come vero." : "Ok, lo tengo solo come storia: non lo userò più come situazione attuale."}
          </span>
        )}
      </div>
      {state === "ask" && (
        <div style={{ display: "flex", gap: 6, flex: "none" }}>
          <button className="btn btn-secondary" onClick={() => answer("yes")} style={{ height: 30 }}>Sì</button>
          <button className="btn btn-secondary" onClick={() => answer("no")} style={{ height: 30 }}>Non più</button>
          <button className="btn btn-ghost" onClick={() => answer("later")} style={{ height: 30, color: "var(--muted)" }}>Più tardi</button>
        </div>
      )}
    </div>
  );
}
