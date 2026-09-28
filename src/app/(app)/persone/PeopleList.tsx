"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui";
import { initials } from "@/lib/format";
import { PersonForm } from "./PersonForm";

type P = { id: string; name: string; role: string; org: string; items: number };

export function PeopleList({ people }: { people: P[] }) {
  const path = usePathname();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const needle = q.trim().toLowerCase();
  const visible = needle ? people.filter((p) => `${p.name} ${p.role} ${p.org}`.toLowerCase().includes(needle)) : people;

  return (
    <aside className="people-side" data-detail={path !== "/persone" || undefined} style={{ borderRight: "1px solid var(--color-divider)", padding: "32px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 8px" }}>
        <h1 className="page-title" style={{ margin: 0, fontSize: 34 }}>Persone</h1>
        <button className="btn btn-ghost btn-icon" title="Nuova persona" aria-label="Nuova persona" onClick={() => setCreating(true)}><Icon name="plus" /></button>
      </div>
      {creating && <div style={{ margin: "0 8px" }}><PersonForm onClose={() => setCreating(false)} /></div>}
      <div style={{ position: "relative", display: "flex", alignItems: "center", margin: "0 8px" }}>
        <span className="muted" style={{ position: "absolute", left: 10 }}><Icon name="search" /></span>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca persone" style={{ paddingLeft: 34 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {visible.map((p) => {
          const active = path === `/persone/${p.id}`;
          return (
            <Link key={p.id} href={`/persone/${p.id}`} className="row-hover" style={{ display: "grid", gridTemplateColumns: "34px minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "10px 8px", background: active ? "var(--sel)" : undefined, color: "inherit", textDecoration: "none" }}>
              <span className="muted" style={{ width: 34, height: 34, borderRadius: "50%", border: "1px solid var(--color-divider)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{initials(p.name)}</span>
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.35, minWidth: 0 }}>
                <span style={{ fontSize: 14 }}>{p.name}</span>
                <span className="muted ellipsis" style={{ fontSize: 12 }}>{[p.role, p.org].filter(Boolean).join(" · ") || "—"}</span>
              </span>
              <span className="muted" style={{ fontSize: 12 }}>{p.items || ""}</span>
            </Link>
          );
        })}
        {!visible.length && <p className="muted" style={{ margin: "8px", fontSize: 13 }}>{people.length ? "Nessun risultato." : "Nessuna persona ancora."}</p>}
      </div>
    </aside>
  );
}
