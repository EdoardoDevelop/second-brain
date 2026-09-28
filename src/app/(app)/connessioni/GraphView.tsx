"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import { saveGraphPositions } from "@/lib/actions";
import type { GraphEdge, GraphNode } from "@/lib/queries";
import { computeLayout, type Positions, type Vec } from "./layout-engine";

type NType = GraphNode["type"];
type Mode = "2d" | "3d";
const TYPES: [NType, string][] = [["person", "Persone"], ["project", "Progetti"], ["document", "Documenti"], ["decision", "Decisioni"], ["concept", "Concetti"], ["note", "Note"], ["task", "Attività"], ["event", "Riunioni"]];
const TYPE_LABEL = Object.fromEntries(TYPES) as Record<NType, string>;
const MODE_KEY = "sb_graph_mode";
/** Distanza focale della prospettiva 3D. */
const FOCAL = 1100;

/** Nodi tutti rotondi: il tipo si distingue da dimensione, riempimento e segno interno. */
function Shape({ type, stroke, sel }: { type: NType; stroke: string; sel: boolean }) {
  const base = { fill: "var(--color-bg)", stroke, strokeWidth: sel ? 2 : 1.2 };
  const mark = { fill: "none", stroke, strokeWidth: 1.5 };
  switch (type) {
    case "project": return <circle r={21} style={{ fill: "var(--color-accent)", stroke: sel ? "var(--color-text)" : "var(--color-accent)", strokeWidth: sel ? 2 : 1 }} />;
    case "person": return <circle r={17} style={base} />;
    case "document": return <g><circle r={15} style={base} /><path d="M-5 -4h10M-5 0h10M-5 4h6" style={mark} /></g>;
    case "decision": return <g><circle r={15} style={base} /><path d="M0 -6L6 0L0 6L-6 0Z" style={mark} /></g>;
    case "concept": return <circle r={14} style={{ ...base, strokeDasharray: "3 3" }} />;
    case "note": return <circle r={13} style={base} />;
    case "task": return <g><circle r={13} style={base} /><path d="M-5 0l3.5 3.5L6 -4" style={mark} /></g>;
    case "event": return <g><circle r={15} style={base} /><circle r={4} style={{ fill: stroke }} /></g>;
  }
}

function Mini({ type, faded }: { type: NType; faded?: boolean }) {
  return (
    <svg width={22} height={22} viewBox="-22 -22 44 44" style={{ display: "block", flex: "none", overflow: "visible", opacity: faded ? 0.4 : 1 }}>
      <Shape type={type} stroke="var(--color-text)" sel={false} />
    </svg>
  );
}

const short = (s: string, n = 24) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

type Cam = { zoom: number; ox: number; oy: number; yaw: number; pitch: number };

/** Rotazione della camera: prima attorno all'asse verticale (yaw), poi a quello orizzontale (pitch). */
function rotate(v: Vec, yaw: number, pitch: number): Vec {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
  return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
}
/** Vettore dello schermo (a destra, in basso) riportato nello spazio del grafo. */
function unrotate(a: number, b: number, yaw: number, pitch: number): Vec {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y = b * cp, z1 = -b * sp;
  return [a * cy - z1 * sy, y, a * sy + z1 * cy];
}

export function GraphView({ nodes, edges, initialSelection, saved }: { nodes: GraphNode[]; edges: GraphEdge[]; initialSelection: string | null; saved: Record<Mode, Positions> }) {
  const router = useRouter();
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const [mode, setMode] = useState<Mode>("2d");
  const [pos, setPos] = useState<Record<Mode, Positions | null>>({ "2d": null, "3d": null });
  const posRef = useRef(pos);
  posRef.current = pos;
  const [off, setOff] = useState<Partial<Record<NType, boolean>>>({ task: true });
  const [sel, setSel] = useState<string | null>(initialSelection);
  const [hover, setHover] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cam, setCam] = useState<Cam>({ zoom: 1, ox: 0, oy: 0, yaw: 0.6, pitch: -0.35 });
  const [spin, setSpin] = useState(false);
  const [menu, setMenu] = useState(false);
  const [size, setSize] = useState({ w: 900, h: 600, measured: false });
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const gesture = useRef<{
    kind: "pan" | "rotate" | "node"; id?: string; x: number; y: number; cam: Cam; moved: boolean; start?: Vec; scale?: number;
  } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number } | null>(null);

  // Modalità ricordata per dispositivo.
  useEffect(() => {
    try { const m = localStorage.getItem(MODE_KEY); if (m === "3d") setMode("3d"); } catch {}
  }, []);

  const persist = (m: Mode, p: Positions, note = "Posizioni salvate") => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      await saveGraphPositions(m, p);
      setSavedNote(note);
      window.setTimeout(() => setSavedNote(null), 1800);
    }, 500);
  };

  // Posizioni della modalità: quelle salvate, più i nodi nuovi disposti attorno (e salvati, così restano stabili).
  useEffect(() => {
    if (pos[mode]) return;
    const dim = mode === "3d" ? 3 : 2;
    const fixed: Positions = {};
    for (const n of nodes) if (saved[mode]?.[n.id]) fixed[n.id] = saved[mode][n.id]!;
    const p = computeLayout(nodes, edges, dim, fixed);
    setPos((all) => ({ ...all, [mode]: p }));
    if (Object.keys(fixed).length !== nodes.length && nodes.length) persist(mode, p, "Nuovi nodi disposti");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const P = pos[mode];
  const is3d = mode === "3d";

  const vis = nodes.filter((n) => !off[n.type]);
  const visIds = new Set(vis.map((n) => n.id));
  const visEdges = edges.filter((e) => visIds.has(e.a) && visIds.has(e.b));
  const selected = sel && visIds.has(sel) ? byId.get(sel)! : null;
  const nb = new Set<string>(selected ? [selected.id] : []);
  for (const e of visEdges) if (selected && (e.a === selected.id || e.b === selected.id)) { nb.add(e.a); nb.add(e.b); }
  const needle = q.trim().toLowerCase();

  // Centro del grafo: attorno a questo punto ruota la vista 3D.
  const center = useMemo<Vec>(() => {
    if (!P) return [0, 0, 0];
    const pts = Object.values(P);
    if (!pts.length) return [0, 0, 0];
    return [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k]!, 0) / pts.length) as Vec;
  }, [P]);

  /** Coordinate sullo schermo, scala prospettica e profondità di un punto del grafo. */
  const project = (p: Vec, c: Cam = cam) => {
    const rel: Vec = [p[0] - center[0], p[1] - center[1], is3d ? p[2] - center[2] : 0];
    const r = is3d ? rotate(rel, c.yaw, c.pitch) : rel;
    const s = is3d ? FOCAL / Math.max(FOCAL + r[2], 120) : 1;
    return { x: size.w / 2 + c.ox + r[0] * s * c.zoom, y: size.h / 2 + c.oy + r[1] * s * c.zoom, s, z: r[2] };
  };

  const fit = (c: Cam = cam) => {
    if (!P) return;
    const list = (vis.length ? vis : nodes).map((n) => P[n.id]).filter(Boolean) as Vec[];
    if (!list.length) return;
    const base = { ...c, zoom: 1, ox: 0, oy: 0 };
    const pts = list.map((p) => project(p, base));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - 100, maxX = Math.max(...xs) + 100, minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 90;
    const zoom = clamp(Math.min(size.w / (maxX - minX), size.h / (maxY - minY)), 0.15, 1.5);
    setCam({ ...c, zoom, ox: -((minX + maxX) / 2 - size.w / 2) * zoom, oy: -((minY + maxY) / 2 - size.h / 2) * zoom });
  };
  const focusOn = (id: string) => {
    if (!P?.[id]) return;
    const p = project(P[id]!);
    setCam((c) => ({ ...c, ox: c.ox - (p.x - size.w / 2), oy: c.oy - (p.y - size.h / 2) }));
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width || 900, h: e!.contentRect.height || 600, measured: true }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Adatta la vista quando le posizioni della modalità sono pronte (e centra il nodo iniziale, se c'è).
  const fittedFor = useRef<Mode | null>(null);
  useEffect(() => {
    if (!P || !size.measured || fittedFor.current === mode) return;
    fittedFor.current = mode;
    fit();
    if (initialSelection && fittedFor.current && P[initialSelection]) requestAnimationFrame(() => focusOn(initialSelection));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [P, size.measured, mode]);

  // Rotazione automatica in 3D.
  useEffect(() => {
    if (!is3d || !spin) return;
    let raf = 0;
    const tick = () => {
      if (!gesture.current) setCam((c) => ({ ...c, yaw: c.yaw + 0.0035 }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [is3d, spin]);

  // Rotella: zoom verso il puntatore; la pagina non scorre.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2, my = e.clientY - rect.top - rect.height / 2;
      setCam((c) => {
        const zoom = clamp(c.zoom * (e.deltaY < 0 ? 1.12 : 0.89), 0.12, 4);
        const k = zoom / c.zoom;
        return { ...c, zoom, ox: mx - (mx - c.ox) * k, oy: my - (my - c.oy) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const switchMode = (m: Mode) => {
    setMode(m);
    setMenu(false);
    try { localStorage.setItem(MODE_KEY, m); } catch {}
  };

  const relayout = (byType: boolean) => {
    setMenu(false);
    const p = computeLayout(nodes, edges, is3d ? 3 : 2, {}, byType);
    setPos((all) => ({ ...all, [mode]: p }));
    fittedFor.current = null;
    persist(mode, p, byType ? "Nodi raggruppati per tipo" : "Nodi riorganizzati");
  };

  const zoomBy = (f: number) => setCam((c) => ({ ...c, zoom: clamp(c.zoom * f, 0.12, 4), ox: c.ox * f, oy: c.oy * f }));
  const open = (n: GraphNode) => { if (n.href) router.push(n.href); };
  const ask = (n: GraphNode) => {
    const scope = n.type === "project" ? `&ambito=project:${n.id}` : n.type === "person" ? `&ambito=person:${n.id}` : "";
    router.push(`/assistente?q=${encodeURIComponent(`Cosa so di «${n.label}»?`)}${scope}`);
  };

  // ——— gesti: trascina un nodo, sposta la vista (2D) o ruota (3D), pizzica per lo zoom ———
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: cam.zoom };
      gesture.current = null;
      return;
    }
    const id = (e.target as Element).closest("[data-node]")?.getAttribute("data-node") ?? null;
    if (id && P?.[id]) {
      gesture.current = { kind: "node", id, x: e.clientX, y: e.clientY, cam, moved: false, start: [...P[id]!] as Vec, scale: project(P[id]!).s };
    } else {
      gesture.current = { kind: is3d && !e.shiftKey && e.button === 0 ? "rotate" : "pan", x: e.clientX, y: e.clientY, cam, moved: false };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const zoom = clamp(pinch.current.zoom * (d / pinch.current.d), 0.12, 4);
      setCam((c) => ({ ...c, zoom }));
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    g.moved = true;
    if (g.kind === "pan") setCam({ ...g.cam, ox: g.cam.ox + dx, oy: g.cam.oy + dy });
    else if (g.kind === "rotate") setCam({ ...g.cam, yaw: g.cam.yaw + dx * 0.008, pitch: clamp(g.cam.pitch - dy * 0.008, -1.45, 1.45) });
    else if (g.kind === "node" && g.id && g.start) {
      const k = 1 / (g.cam.zoom * (g.scale ?? 1));
      const d = is3d ? unrotate(dx * k, dy * k, g.cam.yaw, g.cam.pitch) : ([dx * k, dy * k, 0] as Vec);
      const next: Vec = [g.start[0] + d[0], g.start[1] + d[1], g.start[2] + d[2]];
      setPos((all) => ({ ...all, [mode]: { ...all[mode]!, [g.id!]: next } }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "node" && g.moved) { persist(mode, posRef.current[mode]!); return; }
    if (g.moved) return;
    // Tocco senza trascinamento: seleziona il nodo, o deseleziona.
    setSel(g.kind === "node" ? g.id ?? null : null);
  };

  const conns = selected
    ? edges
        .filter((e) => e.a === selected.id || e.b === selected.id)
        .map((e) => ({ e, o: byId.get(e.a === selected.id ? e.b : e.a)! }))
        .sort((x, y) => Number(y.e.conflict) - Number(x.e.conflict))
    : [];

  // Proiezione e ordine di disegno: i nodi lontani prima, quelli vicini sopra.
  const drawn = P
    ? vis.filter((n) => P[n.id]).map((n) => ({ n, ...project(P[n.id]!) })).sort((a, b) => b.z - a.z)
    : [];
  const at = new Map(drawn.map((d) => [d.n.id, d]));
  const depthAlpha = (s: number) => (is3d ? clamp(0.3 + (s - 0.72) * 1.6, 0.25, 1) : 1);

  return (
    <div className="graph-root" style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px" }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div className="graph-toolbar" style={{ flex: "none", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid var(--color-divider)" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center", width: 200 }}>
            <span className="muted" style={{ position: "absolute", left: 10 }}><Icon name="search" /></span>
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !needle) return;
                const hit = vis.find((n) => n.label.toLowerCase().includes(needle));
                if (hit) { setSel(hit.id); focusOn(hit.id); }
              }}
              placeholder="Trova un nodo"
              style={{ paddingLeft: 34, minHeight: 32, height: 32 }}
            />
          </div>
          <div className="seg-sb">
            {(["2d", "3d"] as Mode[]).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => switchMode(m)} style={{ height: 32, padding: "0 12px" }}>{m.toUpperCase()}</button>)}
          </div>
          {is3d && (
            <button className="btn btn-ghost" aria-pressed={spin} onClick={() => setSpin((s) => !s)} style={{ height: 32, gap: 6, color: spin ? "var(--accent-text)" : "var(--muted)" }}>
              <Icon name="refresh" size={14} />Rotazione
            </button>
          )}
          <div style={{ position: "relative" }}>
            <button className="btn btn-ghost" onClick={() => setMenu((m) => !m)} style={{ height: 32, gap: 6, color: "var(--muted)" }}><Icon name="layout" size={14} />Riorganizza</button>
            {menu && (
              <div className="blueprint" style={{ position: "absolute", top: 38, left: 0, zIndex: 5, width: 250, background: "var(--raised)", boxShadow: "var(--shadow-lg)", padding: 6, display: "flex", flexDirection: "column" }}>
                <button className="list-btn" onClick={() => relayout(false)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "8px 10px", gap: 2, border: 0 }}>
                  <span style={{ fontSize: 14 }}>Disposizione automatica</span><span className="muted" style={{ fontSize: 12 }}>I nodi collegati vicini tra loro.</span>
                </button>
                <button className="list-btn" onClick={() => relayout(true)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "8px 10px", gap: 2, border: 0 }}>
                  <span style={{ fontSize: 14 }}>Raggruppa per tipo</span><span className="muted" style={{ fontSize: 12 }}>Progetti, persone, documenti… in zone separate.</span>
                </button>
                <div className="muted" style={{ fontSize: 11, padding: "6px 10px 4px", borderTop: "1px solid var(--color-divider)", marginTop: 4 }}>Sostituisce le posizioni salvate della vista {mode.toUpperCase()}.</div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            {TYPES.filter(([t]) => nodes.some((n) => n.type === t)).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setOff((o) => ({ ...o, [t]: !o[t] }))}
                title="Mostra/nascondi"
                aria-pressed={!off[t]}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 8px 0 4px", border: 0, background: off[t] ? "var(--hover)" : "transparent", color: off[t] ? "var(--faint)" : "var(--color-text)", font: "inherit", fontSize: 12, cursor: "pointer" }}
              >
                <Mini type={t} faded={off[t]} />{label}
              </button>
            ))}
          </div>
        </div>

        <div
          ref={box}
          style={{
            flex: 1, minHeight: 0, position: "relative", overflow: "hidden", touchAction: "none",
            background: is3d
              ? "radial-gradient(ellipse at center, color-mix(in srgb, var(--color-accent) 7%, transparent), transparent 70%)"
              : undefined,
            backgroundImage: is3d ? undefined : "radial-gradient(var(--color-divider) 1px,transparent 1px)",
            backgroundSize: is3d ? undefined : "28px 28px",
          }}
        >
          {!nodes.length ? (
            <div className="muted" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
              Il grafo si costruisce con gli elementi confermati: progetti, persone, tag e collegamenti.
            </div>
          ) : (
            <svg
              width="100%"
              height="100%"
              style={{ display: "block", cursor: gesture.current ? "grabbing" : "grab", userSelect: "none" }}
              onDoubleClick={(e) => {
                const id = (e.target as Element).closest("[data-node]")?.getAttribute("data-node");
                const n = id ? byId.get(id) : null;
                if (n) open(n);
              }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <g>
                {visEdges.map((e, i) => {
                  const a = at.get(e.a), b = at.get(e.b);
                  if (!a || !b) return null;
                  const on = !!selected && (e.a === selected.id || e.b === selected.id);
                  const alpha = selected && !on ? 0.25 : depthAlpha((a.s + b.s) / 2) * (is3d ? 0.8 : 1);
                  return (
                    <g key={i}>
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: e.conflict ? "var(--danger)" : on ? "var(--color-accent)" : "var(--color-divider)", strokeWidth: on ? 1.6 : 1, strokeDasharray: e.conflict ? "5 4" : undefined, opacity: alpha }} />
                      {e.conflict && on && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 10} textAnchor="middle" style={{ fill: "var(--danger)", fontSize: 12, fontFamily: "var(--font-body)" }}>possibile contraddizione</text>}
                    </g>
                  );
                })}
              </g>
              <g>
                {drawn.map(({ n, x, y, s }) => {
                  const isSel = n.id === selected?.id;
                  const match = !!needle && n.label.toLowerCase().includes(needle);
                  const dim = !!selected && !nb.has(n.id);
                  const stroke = isSel || match ? "var(--color-accent)" : "var(--color-text)";
                  const k = clamp(cam.zoom * s, 0.25, 2.2);
                  // Etichette: sempre in 2D (tranne con zoom molto basso), in 3D solo per i nodi vicini o in evidenza.
                  const important = isSel || match || hover === n.id || (!!selected && nb.has(n.id));
                  const showLabel = important || (is3d ? k > 0.95 : k > 0.42 || n.type === "project");
                  const alpha = dim ? 0.2 : depthAlpha(s);
                  // Etichette di dimensione quasi costante: il nodo scala con zoom e profondità, il testo molto meno.
                  const tk = clamp(k, 0.85, 1.15) / k;
                  return (
                    <g
                      key={n.id}
                      data-node={n.id}
                      transform={`translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${k.toFixed(3)})`}
                      style={{ cursor: "pointer", opacity: alpha }}
                      onPointerEnter={() => setHover(n.id)}
                      onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                    >
                      {match && <circle r={32} style={{ fill: "none", stroke: "var(--color-accent)", strokeDasharray: "2 3" }} />}
                      <Shape type={n.type} stroke={stroke} sel={isSel} />
                      {showLabel && (
                        <text
                          y={(n.type === "project" ? 24 : 18) + 14 * tk}
                          textAnchor="middle"
                          style={{
                            fill: "var(--color-text)", fontSize: (n.type === "project" ? 14 : 12.5) * tk, fontWeight: isSel || n.type === "project" ? 500 : 400,
                            fontFamily: "var(--font-body)", paintOrder: "stroke", stroke: "var(--color-bg)", strokeWidth: 4 * tk, strokeLinejoin: "round",
                          }}
                        >
                          {short(n.label)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
          <div style={{ position: "absolute", bottom: 16, left: 16, display: "flex", alignItems: "center", border: "1px solid var(--color-divider)", background: "var(--color-bg)" }}>
            <button className="btn btn-ghost btn-icon" onClick={() => zoomBy(0.8)} title="Riduci" style={{ color: "var(--muted)", border: 0 }}><Icon name="minus" /></button>
            <span className="muted" style={{ fontSize: 12, width: 44, textAlign: "center" }}>{Math.round(cam.zoom * 100)}%</span>
            <button className="btn btn-ghost btn-icon" onClick={() => zoomBy(1.25)} title="Ingrandisci" style={{ color: "var(--muted)", border: 0 }}><Icon name="plus" /></button>
            <button className="btn btn-ghost btn-icon" onClick={() => fit()} title="Adatta" style={{ color: "var(--muted)", border: 0, borderLeft: "1px solid var(--color-divider)" }}><Icon name="maximize" /></button>
          </div>
          {savedNote && <div className="toast" style={{ position: "absolute", bottom: 16, right: 16, left: "auto", transform: "none", animation: "sbRise .3s var(--ease-decel) both" }}>{savedNote}</div>}
        </div>
      </div>

      <aside className="graph-aside" style={{ borderLeft: "1px solid var(--color-divider)", background: "var(--color-bg)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto" }}>
        {selected ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="eyebrow" style={{ color: "var(--accent-text)" }}>{TYPE_LABEL[selected.type]}</div>
              <h2 style={{ margin: 0, fontSize: 24, fontWeight: 500, overflowWrap: "anywhere" }}>{selected.label}</h2>
              {selected.desc && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{selected.desc}</p>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {selected.href && <Link className="btn btn-primary" href={selected.href} style={{ gap: 6 }}>Apri<Icon name="arrowUR" /></Link>}
              <button className="btn btn-secondary" onClick={() => ask(selected)} style={{ gap: 6 }}><Icon name="ai" />Chiedi</button>
            </div>
            <Section title={`Connessioni · ${conns.length}`}>
              {conns.map(({ e, o }, i) => (
                <button key={i} onClick={() => { setSel(o.id); if (off[o.type]) setOff((f) => ({ ...f, [o.type]: false })); focusOn(o.id); }} className="list-btn" style={{ gridTemplateColumns: "22px minmax(0,1fr) auto", alignItems: "center", padding: "6px 0", fontSize: 14 }} title={e.reason || undefined}>
                  <Mini type={o.type} />
                  <span className="ellipsis">{o.label}</span>
                  {e.conflict && <span style={{ fontSize: 11, color: "var(--danger)" }}>conflitto</span>}
                </button>
              ))}
            </Section>
          </>
        ) : (
          <div className="muted" style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 24, fontSize: 14 }}>
            <span className="faint"><Icon name="graph" size={20} /></span>
            <span>Seleziona un nodo per vedere le sue connessioni.</span>
            <span style={{ fontSize: 13 }}>{vis.length} nodi · {visEdges.length} collegamenti{edges.some((e) => e.conflict) ? ` · ${edges.filter((e) => e.conflict).length} in conflitto` : ""}</span>
          </div>
        )}
        <div className="muted hide-mobile" style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid var(--color-divider)", fontSize: 12, lineHeight: 1.6 }}>
          {is3d
            ? "Trascina lo sfondo per ruotare (Maiusc per spostarti) · rotella per lo zoom · trascina un nodo per spostarlo · doppio clic per aprirlo."
            : "Trascina lo sfondo per spostarti · rotella per lo zoom · trascina un nodo per spostarlo · doppio clic per aprirlo."}{" "}
          Le posizioni restano salvate. Le attività sono nascoste: attivale dai filtri.
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div className="eyebrow muted" style={{ paddingBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
