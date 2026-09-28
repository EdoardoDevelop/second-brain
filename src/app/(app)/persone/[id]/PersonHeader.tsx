"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import type { PersonInput } from "@/lib/actions";
import { PersonForm } from "../PersonForm";

/** Intestazione della persona con il passaggio al modulo di modifica. */
export function PersonHeader({ id, initial, children }: { id: string; initial: PersonInput; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <PersonForm id={id} initial={initial} onClose={() => setEditing(false)} />;
  return (
    <header style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      {children}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-secondary" onClick={() => setEditing(true)}>Modifica</button>
        <Link className="btn btn-secondary" href={`/assistente?ambito=person:${id}&q=${encodeURIComponent(`Cosa so di ${initial.name}?`)}`} style={{ gap: 6 }}><Icon name="ai" />Chiedi</Link>
      </div>
    </header>
  );
}
