"use client";

import Link from "next/link";
import { useState } from "react";
import { Blueprint, Icon } from "@/components/ui";
import { initials } from "@/lib/format";
import type { Project } from "@/lib/db/schema";
import { ProjectForm } from "./ProjectForm";

type P = Project & { items: number; openTasks: number; people: string[] };

const FILTERS = ["Attivi", "In pausa", "Chiusi", "Tutti"] as const;
const MATCH: Record<(typeof FILTERS)[number], string | null> = { Attivi: "Attivo", "In pausa": "In pausa", Chiusi: "Chiuso", Tutti: null };

export function ProjectsView({ projects }: { projects: P[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Attivi");
  const [creating, setCreating] = useState(false);
  const visible = projects.filter((p) => !MATCH[filter] || p.status === MATCH[filter]);

  return (
    <div className="page" style={{ maxWidth: 1320, gap: 28 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ margin: 0, fontSize: 40 }}>Progetti</h1>
          <div className="muted" style={{ fontSize: 14 }}>Ogni progetto raccoglie obiettivi, attività, persone e documenti.</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="seg-sb">
            {FILTERS.map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} style={{ height: 32, padding: "0 12px" }}>{f}</button>)}
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)} style={{ gap: 6, height: 34 }}><Icon name="plus" />Nuovo progetto</button>
        </div>
      </div>

      {creating && <ProjectForm onClose={() => setCreating(false)} />}

      {!projects.length ? (
        !creating && (
          <div className="empty" style={{ padding: "64px 24px" }}>
            <span className="faint"><Icon name="folder" size={20} /></span>
            <div className="empty-title" style={{ fontSize: 22 }}>Nessun progetto</div>
            <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 400 }}>Crea un progetto: gli elementi della memoria e le attività potranno esservi collegati.</p>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>Nuovo progetto</button>
          </div>
        )
      ) : !visible.length ? (
        <div className="muted" style={{ padding: 48, textAlign: "center", border: "1px dashed var(--color-divider)" }}>Nessun progetto in questa vista.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 28 }}>
          {visible.map((p) => (
            <Link key={p.id} href={`/progetti/${p.id}`} style={{ color: "inherit", textDecoration: "none" }}>
              <Blueprint className="card-hover" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <StatusBadge status={p.status} />
                  <span className="muted" style={{ fontSize: 13 }}>{p.pct}%</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <h3 style={{ margin: 0, fontSize: 25 }}>{p.name}</h3>
                  {p.description && <p className="muted" style={{ margin: 0, fontSize: 14, textWrap: "pretty" }}>{p.description}</p>}
                </div>
                <div style={{ height: 3, background: "var(--skel)" }}>
                  <div style={{ height: 3, width: p.pct + "%", background: p.status === "Attivo" ? "var(--color-accent)" : "var(--muted)" }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                  {p.next && <span>{p.next}</span>}
                  <span className="muted" style={{ fontSize: 12 }}>{p.items} elementi · {p.openTasks} attività aperte</span>
                </div>
                {p.people.length > 0 && (
                  <div style={{ display: "flex", marginTop: "auto" }}>
                    {p.people.slice(0, 5).map((n) => (
                      <span key={n} title={n} className="muted" style={{ width: 26, height: 26, marginRight: -6, borderRadius: "50%", border: "1px solid var(--color-divider)", background: "var(--color-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{initials(n)}</span>
                    ))}
                  </div>
                )}
              </Blueprint>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const active = status === "Attivo";
  return <span style={{ fontSize: 11, padding: "1px 7px", background: active ? "var(--sel)" : "var(--skel)", color: active ? "var(--accent-text)" : "var(--muted)" }}>{status}</span>;
}
