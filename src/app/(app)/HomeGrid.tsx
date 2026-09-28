"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import { saveHomeLayout } from "@/lib/actions";
import { DEFAULT_HOME, SIZE_LABEL, SIZE_SPAN, WIDGETS, type HomeLayout, type WidgetId, type WidgetSize } from "@/lib/home";

/**
 * Griglia della Home. In modalità "Personalizza" i riquadri si trascinano (o si spostano con le frecce),
 * cambiano dimensione e si nascondono; la disposizione si salva sul server ed è la stessa su tutti i dispositivi.
 */
export function HomeGrid({ initial, contents, header, summary }: { initial: HomeLayout; contents: Record<WidgetId, ReactNode>; header: ReactNode; summary: ReactNode }) {
  const [layout, setLayout] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState<WidgetId | null>(null);
  const [, start] = useTransition();
  const timer = useRef<number | undefined>(undefined);

  const change = (next: HomeLayout) => {
    setLayout(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => start(() => saveHomeLayout(next)), 400);
  };
  const patch = (id: WidgetId, p: Partial<HomeLayout["widgets"][number]>) =>
    change({ ...layout, widgets: layout.widgets.map((w) => (w.id === id ? { ...w, ...p } : w)) });
  /** Sposta un riquadro tra quelli visibili (i nascosti non contano per l'ordine). */
  const move = (id: WidgetId, dir: -1 | 1) => {
    const vis = layout.widgets.filter((w) => !w.hidden);
    const i = vis.findIndex((w) => w.id === id);
    const other = vis[i + dir];
    if (!other) return;
    moveBefore(id, dir < 0 ? other.id : vis[i + 2]?.id ?? null);
  };
  /** Mette `id` prima di `before` (null = in fondo). */
  const moveBefore = (id: WidgetId, before: WidgetId | null) => {
    if (id === before) return;
    const w = layout.widgets.find((x) => x.id === id)!;
    const rest = layout.widgets.filter((x) => x.id !== id);
    const at = before ? rest.findIndex((x) => x.id === before) : rest.length;
    rest.splice(at < 0 ? rest.length : at, 0, w);
    change({ ...layout, widgets: rest });
  };

  const visible = layout.widgets.filter((w) => !w.hidden);
  const hidden = layout.widgets.filter((w) => w.hidden);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 780 }}>
        {header}
        {layout.summary && summary}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: -16 }}>
        {editing && (
          <>
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginRight: "auto" }}>
              <input type="checkbox" checked={layout.summary} onChange={(e) => change({ ...layout, summary: e.target.checked })} />
              Mostra la sintesi del giorno
            </label>
            <button className="btn btn-ghost" onClick={() => change(DEFAULT_HOME)} style={{ color: "var(--muted)" }}>Ripristina</button>
          </>
        )}
        <button className={editing ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setEditing((e) => !e)} style={{ gap: 6, color: editing ? undefined : "var(--muted)" }}>
          <Icon name={editing ? "check" : "layout"} size={14} />{editing ? "Fatto" : "Personalizza"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 28 }}>
        {visible.map((w, i) => {
          const meta = WIDGETS[w.id];
          return (
            <section
              key={w.id}
              className="blueprint span-mobile home-widget"
              data-editing={editing || undefined}
              data-drop={dragId && dragId !== w.id ? "true" : undefined}
              draggable={editing}
              onDragStart={(e) => { setDragId(w.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => { if (dragId) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragId) moveBefore(dragId, w.id); setDragId(null); }}
              style={{ gridColumn: `span ${SIZE_SPAN[w.size]}`, minWidth: 0, padding: "18px 20px 16px", display: "flex", flexDirection: "column", gap: 12, animation: "sbIn .25s ease", opacity: dragId === w.id ? 0.4 : 1, cursor: editing ? "grab" : undefined }}
            >
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 28 }}>
                {editing && <span className="muted" title="Trascina per spostare"><Icon name="grip" size={14} /></span>}
                <h4 className="ellipsis" style={{ margin: 0, fontSize: 19, flex: 1 }}>{meta.title}</h4>
                {!editing && meta.href && <Link href={meta.href} title="Apri" className="muted" style={{ padding: 4 }}><Icon name="arrowUR" /></Link>}
              </div>
              {editing ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="muted" style={{ fontSize: 13 }}>{meta.desc}</div>
                  <div className="seg-sb" style={{ alignSelf: "flex-start" }}>
                    {(Object.keys(SIZE_LABEL) as WidgetSize[]).map((s) => (
                      <button key={s} aria-pressed={w.size === s} onClick={() => patch(w.id, { size: s })} style={{ height: 30, padding: "0 10px", fontSize: 12 }}>{SIZE_LABEL[s]}</button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn btn-secondary btn-icon" onClick={() => move(w.id, -1)} disabled={i === 0} title="Sposta prima" aria-label="Sposta prima" style={{ height: 32, width: 32 }}><Icon name="chevL" size={14} /></button>
                    <button className="btn btn-secondary btn-icon" onClick={() => move(w.id, 1)} disabled={i === visible.length - 1} title="Sposta dopo" aria-label="Sposta dopo" style={{ height: 32, width: 32 }}><Icon name="chevR" size={14} /></button>
                    <span style={{ flex: 1 }} />
                    <button className="btn btn-ghost" onClick={() => patch(w.id, { hidden: true })} style={{ gap: 6, color: "var(--muted)" }}><Icon name="eyeOff" size={14} />Nascondi</button>
                  </div>
                </div>
              ) : contents[w.id]}
            </section>
          );
        })}
        {editing && (
          <div className="span-mobile" style={{ gridColumn: "span 12", display: "flex", flexDirection: "column", gap: 10, padding: "16px 0 0", borderTop: "1px solid var(--color-divider)" }}>
            <div className="eyebrow muted">Riquadri nascosti</div>
            {hidden.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
                {hidden.map((w) => (
                  <button key={w.id} onClick={() => { const rest = layout.widgets.filter((x) => x.id !== w.id); change({ ...layout, widgets: [...rest.filter((x) => !x.hidden), { ...w, hidden: false }, ...rest.filter((x) => x.hidden)] }); }}
                    style={{ textAlign: "left", padding: "10px 12px", cursor: "pointer", background: "transparent", color: "var(--color-text)", border: "1px dashed var(--faint)", borderRadius: "var(--r)", display: "flex", gap: 10, alignItems: "flex-start", font: "inherit" }}>
                    <span style={{ color: "var(--accent-text)", paddingTop: 2 }}><Icon name="plus" size={14} /></span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14 }}>{WIDGETS[w.id].title}</span>
                      <span className="muted" style={{ fontSize: 12 }}>{WIDGETS[w.id].desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : <span className="muted" style={{ fontSize: 13 }}>Tutti i riquadri sono già nella Home.</span>}
          </div>
        )}
      </div>
    </>
  );
}
