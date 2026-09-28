"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

/** Immagini che si aprono nel popup: gli allegati caricati e qualsiasi <img data-zoom>. */
const TARGETS = 'img[src^="/api/files/"], img[data-zoom]';
const MAX = 6;

type Shot = { src: string; alt: string; download: string };

const toShot = (img: HTMLImageElement): Shot => {
  const src = img.getAttribute("src")!;
  return { src, alt: img.alt, download: img.dataset.download ?? (src.startsWith("/api/files/") ? `${src}?download=1` : src) };
};

/**
 * Popup a tutto schermo per le immagini caricate. Un solo listener per tutta l'app (come Ripple):
 * clic su un'immagine → popup con zoom (rotella, pizzico, doppio clic), trascinamento, frecce
 * tra le immagini della pagina, Scarica; si chiude con Esc, clic sul fondo o il tasto Indietro.
 */
export function Lightbox() {
  const [list, setList] = useState<Shot[]>([]);
  const [i, setI] = useState(-1);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; z: number; x: number; y: number; moved: boolean; bg: boolean } | null>(null);
  const open = i >= 0;

  const close = useCallback(() => {
    if (history.state?.sbLightbox) history.back();
    else setI(-1);
  }, []);

  // Apertura: clic su un'immagine compatibile, ovunque nell'app.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const img = (e.target as Element | null)?.closest?.<HTMLImageElement>(TARGETS);
      if (!img || img.closest("[data-no-zoom]")) return;
      e.preventDefault();
      e.stopPropagation();
      const all = [...document.querySelectorAll<HTMLImageElement>(TARGETS)].filter((x) => !x.closest("[data-no-zoom]"));
      const shots = all.map(toShot).filter((s, k, a) => a.findIndex((o) => o.src === s.src) === k);
      setList(shots);
      setI(Math.max(0, shots.findIndex((s) => s.src === img.getAttribute("src"))));
      setView({ z: 1, x: 0, y: 0 });
      history.pushState({ ...history.state, sbLightbox: 1 }, "");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Il tasto Indietro (Android, browser) chiude il popup invece di cambiare pagina.
  useEffect(() => {
    const onPop = () => setI(-1);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((d: number) => {
    if (list.length < 2) return;
    setI((k) => (k + d + list.length) % list.length);
    setView({ z: 1, x: 0, y: 0 });
  }, [list.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "+" || e.key === "=") setView((v) => ({ ...v, z: Math.min(MAX, v.z * 1.25) }));
      else if (e.key === "-") setView((v) => (v.z / 1.25 <= 1 ? { z: 1, x: 0, y: 0 } : { ...v, z: v.z / 1.25 }));
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    addEventListener("keydown", onKey);
    return () => { removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, close, go]);

  if (!open || !list[i]) return null;
  const shot = list[i];

  /** Zoom attorno al punto (cx, cy), in coordinate relative al centro dello schermo. */
  const zoomAt = (z: number, cx: number, cy: number) =>
    setView((v) => {
      const nz = Math.max(1, Math.min(MAX, z));
      if (nz === 1) return { z: 1, x: 0, y: 0 };
      const k = nz / v.z;
      return { z: nz, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  const center = (e: { clientX: number; clientY: number }) => [e.clientX - innerWidth / 2, e.clientY - innerHeight / 2] as const;

  const onPointerDown = (e: React.PointerEvent) => {
    const bg = e.target === e.currentTarget;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = { dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, z: view.z, x: e.clientX, y: e.clientY, moved: false, bg };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const last = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!last || !g) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && g.dist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const [cx, cy] = center({ clientX: (pts[0].x + pts[1].x) / 2, clientY: (pts[0].y + pts[1].y) / 2 });
      zoomAt(g.z * (d / g.dist), cx, cy);
      g.moved = true;
    } else if (pts.length === 1) {
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 6) g.moved = true;
      if (view.z > 1) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) return;
    gesture.current = null;
    if (!g) return;
    // Senza zoom, uno scorrimento orizzontale passa all'immagine accanto.
    const dx = e.clientX - g.x;
    if (view.z === 1 && g.moved && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - g.y)) go(dx < 0 ? 1 : -1);
    else if (!g.moved && g.bg) close();
  };

  const btn = (label: string, icon: Parameters<typeof Icon>[0]["name"], onClick: () => void) => (
    <button className="lb-btn" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={label} title={label}><Icon name={icon} size={20} /></button>
  );

  return (
    <div className="lb-root sb-scrim" role="dialog" aria-modal="true" aria-label={shot.alt || "Immagine"}>
      <div
        className="lb-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => { const [cx, cy] = center(e); zoomAt(view.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), cx, cy); }}
        onDoubleClick={(e) => { const [cx, cy] = center(e); zoomAt(view.z > 1 ? 1 : 2.5, cx, cy); }}
        style={{ cursor: view.z > 1 ? "grab" : "zoom-in" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={shot.src}
          src={shot.src}
          alt={shot.alt}
          draggable={false}
          className="lb-img"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
        />
      </div>
      <div className="lb-bar" onPointerDown={(e) => e.stopPropagation()}>
        <span className="lb-title ellipsis">{shot.alt}{list.length > 1 && <span className="lb-count"> · {i + 1} di {list.length}</span>}</span>
        {btn("Riduci", "minus", () => zoomAt(view.z / 1.5, 0, 0))}
        {btn("Ingrandisci", "plus", () => zoomAt(view.z * 1.5, 0, 0))}
        {btn(view.z > 1 ? "Adatta allo schermo" : "Ingrandisci", "maximize", () => zoomAt(view.z > 1 ? 1 : 2.5, 0, 0))}
        <a className="lb-btn" href={shot.download} download aria-label="Scarica" title="Scarica" onClick={(e) => e.stopPropagation()}><Icon name="download" size={20} /></a>
        {btn("Chiudi", "x", close)}
      </div>
      {list.length > 1 && (
        <>
          <div className="lb-nav lb-prev" onPointerDown={(e) => e.stopPropagation()}>{btn("Precedente", "chevronL", () => go(-1))}</div>
          <div className="lb-nav lb-next" onPointerDown={(e) => e.stopPropagation()}>{btn("Successiva", "chevronR", () => go(1))}</div>
        </>
      )}
    </div>
  );
}
