"use client";

import Link from "next/link";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { Icon, itemIcon } from "@/components/ui";
import { toggleFavorite } from "@/lib/actions";
import type { ItemKind, ItemType } from "@/lib/db/schema";

type Row = {
  id: string; kind: ItemKind; type: ItemType | null; title: string; summary: string | null; content: string;
  tags: string[]; origin: string; date: string; ts: number; favorite: boolean; projectId: string | null; links: number; conflict: boolean;
};

type View = "all" | "recent" | "fav" | "conflict";

export function KnowledgeView({ rows, projects, initialQuery }: { rows: Row[]; projects: { id: string; name: string }[]; initialQuery: string }) {
  const [q, setQ] = useState(initialQuery);
  const [view, setView] = useState<View>("all");
  const [type, setType] = useState<ItemType | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [favs, toggleFav] = useOptimistic(new Set(rows.filter((r) => r.favorite).map((r) => r.id)), (s, id: string) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const [, start] = useTransition();
  const [showFilters, setShowFilters] = useState(false);

  const types = useMemo(() => [...new Set(rows.map((r) => r.type ?? "Nota"))], [rows]);
  const tags = useMemo(() => {
    const c = new Map<string, number>();
    rows.forEach((r) => r.tags.forEach((t) => c.set(t, (c.get(t) ?? 0) + 1)));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([t]) => t);
  }, [rows]);

  const query = q.trim().toLowerCase();
  const filtered = rows.filter((r) =>
    (!type || (r.type ?? "Nota") === type) &&
    (!tag || r.tags.includes(tag)) &&
    (!project || r.projectId === project) &&
    (view !== "fav" || favs.has(r.id)) &&
    (view !== "conflict" || r.conflict) &&
    (!query || [r.title, r.summary, r.content, r.tags.join(" "), r.type].join(" ").toLowerCase().includes(query)),
  );
  const list = view === "recent" ? [...filtered].sort((a, b) => b.ts - a.ts).slice(0, 10) : filtered;
  const hasFilter = !!(query || type || tag || project || view !== "all");
  const clear = () => { setQ(""); setType(null); setTag(null); setProject(null); setView("all"); };

  const views: [View, string, number][] = [
    ["all", "Tutto", rows.length],
    ["recent", "Recenti", Math.min(10, rows.length)],
    ["fav", "Preferiti", favs.size],
    ["conflict", "In conflitto", rows.filter((r) => r.conflict).length],
  ];

  if (!rows.length) {
    return (
      <div className="page" style={{ maxWidth: 980, gap: 28 }}>
        <h1 className="page-title" style={{ margin: 0, fontSize: 40 }}>Conoscenza</h1>
        <div className="empty" style={{ padding: "64px 24px" }}>
          <span className="faint"><Icon name="book" size={20} /></span>
          <div className="empty-title" style={{ fontSize: 22 }}>La memoria è vuota</div>
          <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 420 }}>Cattura note, documenti o link dall&apos;Inbox. Dopo la tua conferma compariranno qui, già collegati.</p>
          <Link href="/inbox" className="btn btn-primary" style={{ gap: 6 }}><Icon name="plus" />Prima cattura</Link>
        </div>
      </div>
    );
  }

  const activeFilters = [type, project, tag && "#" + tag, view !== "all" && views.find((v) => v[0] === view)?.[1]].filter(Boolean) as string[];

  // Su mobile i filtri stanno in un pannello che si apre sotto la ricerca, invece che in una colonna.
  const filters = (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div className="eyebrow faint" style={{ padding: "0 10px 6px" }}>Viste</div>
          {views.map(([id, l, c]) => (
            <button key={id} className="side-row" aria-pressed={view === id} onClick={() => setView(id)}><span>{l}</span><span className="faint" style={{ fontSize: 12 }}>{c}</span></button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div className="eyebrow faint" style={{ padding: "0 10px 6px" }}>Tipi</div>
          {types.map((t) => (
            <button key={t} className="side-row" aria-pressed={type === t} onClick={() => setType(type === t ? null : t)}>
              <span>{t}</span><span className="faint" style={{ fontSize: 12 }}>{rows.filter((r) => (r.type ?? "Nota") === t).length}</span>
            </button>
          ))}
        </div>
        {projects.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div className="eyebrow faint" style={{ padding: "0 10px 6px" }}>Progetti</div>
            {projects.map((p) => (
              <button key={p.id} className="side-row" aria-pressed={project === p.id} onClick={() => setProject(project === p.id ? null : p.id)}>
                <span className="ellipsis">{p.name}</span><span className="faint" style={{ fontSize: 12 }}>{rows.filter((r) => r.projectId === p.id).length}</span>
              </button>
            ))}
          </div>
        )}
        {tags.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="eyebrow faint" style={{ padding: "0 10px" }}>Tag</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 10px" }}>
              {tags.map((t) => (
                <button key={t} onClick={() => setTag(tag === t ? null : t)} style={{ height: 24, padding: "0 8px", border: 0, background: tag === t ? "var(--color-accent)" : "var(--hover)", color: tag === t ? "var(--color-bg)" : "var(--muted)", font: "inherit", fontSize: 12, cursor: "pointer" }}>#{t}</button>
              ))}
            </div>
          </div>
        )}
      </div>
  );

  return (
    <div className="page stack-mobile" style={{ maxWidth: 1320, padding: "40px 32px 72px", display: "grid", gridTemplateColumns: "180px minmax(0,1fr)", gap: 28 }}>
      <aside className="hide-mobile" style={{ paddingTop: 6 }}>{filters}</aside>

      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 className="page-title" style={{ margin: 0, fontSize: 40 }}>Conoscenza</h1>
            <div className="muted" style={{ fontSize: 14 }}>{list.length} {list.length === 1 ? "elemento" : "elementi"} · più recenti prima</div>
          </div>
          {hasFilter && <button className="btn btn-ghost" onClick={clear} style={{ gap: 6 }}><Icon name="x" />Rimuovi filtri</button>}
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <span className="muted" style={{ position: "absolute", left: 12 }}><Icon name="search" /></span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca per titolo, contenuto, tag…" style={{ height: 42, paddingLeft: 38, fontSize: 15 }} />
        </div>
        <div className="mobile-block" style={{ flexDirection: "column", gap: 16 }}>
          <button className="btn btn-secondary" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} style={{ alignSelf: "flex-start", gap: 6 }}>
            <Icon name="filter" />Filtri{activeFilters.length ? ` · ${activeFilters.join(", ")}` : ""}
          </button>
          {showFilters && <div style={{ padding: "16px 0", borderTop: "1px solid var(--color-divider)", borderBottom: "1px solid var(--color-divider)" }}>{filters}</div>}
        </div>

        {list.length ? (
          <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--color-divider)" }}>
            {list.map((r) => (
              <Link key={r.id} href={`/conoscenza/${r.id}`} className="row-hover kn-row" style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr) minmax(90px,130px)", gap: 16, padding: "18px 12px", borderBottom: "1px solid var(--color-divider)", color: "inherit", textDecoration: "none" }}>
                <span className="muted" style={{ paddingTop: 2 }}><Icon name={itemIcon(r.type, r.kind)} size={20} /></span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19, lineHeight: 1.2 }}>{r.title}</span>
                    {r.conflict && <span style={{ fontSize: 11, padding: "1px 7px", background: "var(--danger-bg)", color: "var(--danger)" }}>Conflitto</span>}
                  </div>
                  {r.summary && (
                    <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5, textWrap: "pretty" }}>
                      <span style={{ color: "var(--accent-text)", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", marginRight: 6 }}>Sintesi IA</span>{r.summary}
                    </p>
                  )}
                  {r.tags.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{r.tags.map((t) => <span key={t} className="muted" style={{ fontSize: 12 }}>#{t}</span>)}</div>}
                </div>
                <div className="muted kn-meta" style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, alignItems: "flex-end", textAlign: "right" }}>
                  <button
                    title="Preferito"
                    className="kn-star"
                    onClick={(e) => { e.preventDefault(); start(async () => { toggleFav(r.id); await toggleFavorite(r.id); }); }}
                    style={{ border: 0, background: "none", color: favs.has(r.id) ? "var(--color-accent)" : "var(--faint)", cursor: "pointer", padding: "0 0 4px" }}
                  >
                    <Icon name="star" />
                  </button>
                  <span style={{ color: "var(--color-text)" }}>{r.type ?? "Nota"} · {r.date}</span>
                  <span>{r.origin}</span>
                  <span>{r.links} {r.links === 1 ? "collegamento" : "collegamenti"}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty">
            <span className="faint"><Icon name="search" size={20} /></span>
            <div className="empty-title">Nessun risultato</div>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Prova con altre parole o rimuovi i filtri.</p>
            <button className="btn btn-secondary" onClick={clear}>Rimuovi filtri</button>
          </div>
        )}
      </div>
    </div>
  );
}
