"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Icon } from "@/components/ui";
import { linkAimItem } from "@/lib/actions";

type A = { id: string; title: string };

/** Nel dettaglio di un elemento: gli obiettivi personali a cui è collegato e il menu per collegarne un altro. */
export function AimLinks({ itemId, linked, open }: { itemId: string; linked: A[]; open: A[] }) {
  const [pending, start] = useTransition();
  const free = open.filter((a) => !linked.some((l) => l.id === a.id));
  if (!linked.length && !free.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-busy={pending || undefined}>
      <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon name="target" />Obiettivi</div>
      {linked.map((a) => (
        <div key={a.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 28px", gap: 8, alignItems: "center", fontSize: 14 }}>
          <Link href={`/obiettivi/${a.id}`} style={{ color: "var(--accent-text)", textDecoration: "none" }}>{a.title}</Link>
          <button className="btn btn-ghost" onClick={() => start(() => linkAimItem(a.id, itemId, false))} aria-label={`Scollega da ${a.title}`} title="Scollega"
            style={{ height: 28, width: 28, padding: 0, justifyContent: "center", color: "var(--muted)" }}><Icon name="x" size={13} /></button>
        </div>
      ))}
      {free.length > 0 && (
        <select className="input" value="" onChange={(e) => { const id = e.target.value; if (id) start(() => linkAimItem(id, itemId, true)); }} aria-label="Collega a un obiettivo" style={{ fontSize: 13 }}>
          <option value="">{linked.length ? "Collega a un altro obiettivo…" : "Collega a un obiettivo…"}</option>
          {free.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
        </select>
      )}
    </div>
  );
}
