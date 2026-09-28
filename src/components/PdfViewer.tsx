"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./ui";
import { openPdf, renderPage, type PdfDoc } from "@/lib/pdfjs";

type File = { url: string; name: string; download: string };
const MIN = 0.5, MAX = 5, GAP = 12;

/** Apre il lettore da codice (per esempio da un pulsante). */
export function showPdf(url: string, name: string, download?: string) {
  window.dispatchEvent(new CustomEvent("sb:pdf", { detail: { url, name, download: download ?? `${url}?download=1` } }));
}

/**
 * Lettore PDF integrato, montato nel layout radice: si apre al clic su qualsiasi <a data-pdf>
 * (href = indirizzo del file, data-pdf = nome mostrato) o con showPdf(). Pagine disegnate con
 * pdf.js solo quando si avvicinano allo schermo; zoom con pulsanti, Ctrl+rotella, pizzico;
 * si chiude con Esc, X o il tasto Indietro.
 */
export function PdfViewer() {
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    const show = (f: File) => {
      setFile(f);
      history.pushState({ ...history.state, sbPdf: 1 }, "");
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[data-pdf]");
      if (!a) return;
      e.preventDefault();
      const url = a.getAttribute("href")!;
      show({ url, name: a.dataset.pdf || "Documento PDF", download: a.dataset.download ?? `${url}?download=1` });
    };
    const onShow = (e: Event) => show((e as CustomEvent<File>).detail);
    const onPop = () => setFile(null);
    document.addEventListener("click", onClick, true);
    addEventListener("sb:pdf", onShow);
    addEventListener("popstate", onPop);
    return () => { document.removeEventListener("click", onClick, true); removeEventListener("sb:pdf", onShow); removeEventListener("popstate", onPop); };
  }, []);

  const close = useCallback(() => {
    if (history.state?.sbPdf) history.back();
    else setFile(null);
  }, []);

  return file ? <Reader key={file.url} file={file} onClose={close} /> : null;
}

function Reader({ file, onClose }: { file: File; onClose: () => void }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [ratios, setRatios] = useState<number[]>([]);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(0);
  const [current, setCurrent] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const pagesEl = useRef<HTMLDivElement>(null);
  // Punto da tenere fermo dopo un cambio di zoom (coordinate nel contenuto e sullo schermo).
  const anchor = useRef<{ px: number; py: number; cx: number; cy: number; k: number } | null>(null);
  const pinch = useRef<{ ids: Map<number, { x: number; y: number }>; start: number; cx: number; cy: number; ratio: number } | null>(null);

  // Apertura del documento e proporzioni di tutte le pagine (per i segnaposto).
  useEffect(() => {
    let alive = true;
    const pdf = openPdf(file.url);
    pdf.promise.then(async (d) => {
      if (!alive) return;
      const first = (await d.getPage(1)).getViewport({ scale: 1 });
      const r = Array<number>(d.numPages).fill(first.height / first.width);
      setDoc(d);
      setRatios(r);
      for (let n = 2; n <= d.numPages && alive; n++) {
        const v = (await d.getPage(n)).getViewport({ scale: 1 });
        r[n - 1] = v.height / v.width;
      }
      if (alive) setRatios([...r]);
    }).catch(() => alive && setError(true));
    return () => { alive = false; pdf.close(); };
  }, [file.url]);

  // Larghezza "adatta alla pagina", ricalcolata quando cambia la finestra.
  useEffect(() => {
    const el = scroller.current!;
    const measure = () => setFit(Math.min(el.clientWidth - 32, 960));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomTo = useCallback((z: number, cx?: number, cy?: number) => {
    const el = scroller.current;
    if (!el) return;
    setZoom((old) => {
      const nz = Math.max(MIN, Math.min(MAX, Math.round(z * 100) / 100));
      if (nz === old) return old;
      const x = cx ?? el.clientWidth / 2, y = cy ?? el.clientHeight / 2;
      anchor.current = { px: el.scrollLeft + x, py: el.scrollTop + y, cx: x, cy: y, k: nz / old };
      return nz;
    });
  }, []);

  // Dopo lo zoom, riporta sotto il dito (o al centro) lo stesso punto del documento.
  useLayoutEffect(() => {
    const a = anchor.current, el = scroller.current;
    if (!a || !el) return;
    anchor.current = null;
    el.scrollLeft = a.px * a.k - a.cx;
    el.scrollTop = a.py * a.k - a.cy;
  }, [zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomTo(zoom * 1.25);
      else if (e.key === "-") zoomTo(zoom / 1.25);
      else if (e.key === "0") zoomTo(1);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    addEventListener("keydown", onKey);
    return () => { removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [zoom, zoomTo, onClose]);

  // Ctrl+rotella (e il pizzico del trackpad, che arriva come Ctrl+rotella): zoom verso il puntatore.
  useEffect(() => {
    const el = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, zoomTo]);

  // Pizzico sul telefono: anteprima con transform durante il gesto, nuovo rendering alla fine.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    const p = (pinch.current ??= { ids: new Map(), start: 0, cx: 0, cy: 0, ratio: 1 });
    p.ids.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (p.ids.size === 2) {
      const [a, b] = [...p.ids.values()];
      const r = scroller.current!.getBoundingClientRect();
      p.start = Math.hypot(a.x - b.x, a.y - b.y);
      p.cx = (a.x + b.x) / 2 - r.left;
      p.cy = (a.y + b.y) / 2 - r.top;
      p.ratio = 1;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pinch.current;
    if (!p?.ids.has(e.pointerId)) return;
    p.ids.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (p.ids.size !== 2 || !p.start) return;
    const [a, b] = [...p.ids.values()];
    p.ratio = Math.max(MIN / zoom, Math.min(MAX / zoom, Math.hypot(a.x - b.x, a.y - b.y) / p.start));
    const el = scroller.current!;
    pagesEl.current!.style.transformOrigin = `${el.scrollLeft + p.cx}px ${el.scrollTop + p.cy}px`;
    pagesEl.current!.style.transform = `scale(${p.ratio})`;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pinch.current;
    if (!p?.ids.has(e.pointerId)) return;
    p.ids.delete(e.pointerId);
    if (p.ids.size) return;
    pinch.current = null;
    pagesEl.current!.style.transform = "";
    if (p.start && Math.abs(p.ratio - 1) > 0.02) zoomTo(zoom * p.ratio, p.cx, p.cy);
  };

  const onScroll = () => {
    const el = scroller.current, box = pagesEl.current;
    if (!el || !box) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let n = 1;
    for (const c of box.children as HTMLCollectionOf<HTMLElement>) {
      if (c.offsetTop <= mid) n = Number(c.dataset.page);
      else break;
    }
    setCurrent(n);
  };

  const width = Math.round(fit * zoom);
  const btn = (label: string, icon: Parameters<typeof Icon>[0]["name"], onClick: () => void, disabled = false) => (
    <button className="lb-btn" onClick={onClick} disabled={disabled} aria-label={label} title={label}><Icon name={icon} size={20} /></button>
  );

  return (
    <div className="lb-root pdf-root sb-scrim" role="dialog" aria-modal="true" aria-label={file.name}>
      <div className="lb-bar pdf-bar">
        <span className="lb-title ellipsis">{file.name}{doc && <span className="lb-count"> · {current} di {doc.numPages}</span>}</span>
        {btn("Riduci", "minus", () => zoomTo(zoom / 1.25), zoom <= MIN)}
        <button className="lb-btn pdf-zoom" onClick={() => zoomTo(1)} title="Adatta alla larghezza">{Math.round(zoom * 100)}%</button>
        {btn("Ingrandisci", "plus", () => zoomTo(zoom * 1.25), zoom >= MAX)}
        <a className="lb-btn" href={file.download} download aria-label="Scarica" title="Scarica"><Icon name="download" size={20} /></a>
        {btn("Chiudi", "x", onClose)}
      </div>
      <div
        ref={scroller}
        className="pdf-scroll"
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {error ? (
          <div className="pdf-msg">
            <div>Non riesco ad aprire questo PDF.</div>
            <a className="btn btn-secondary" href={file.download} download style={{ gap: 6 }}><Icon name="download" />Scarica il file</a>
          </div>
        ) : !doc || !fit ? (
          <div className="pdf-msg"><span className="pdf-spinner" />Apro il documento…</div>
        ) : (
          <div ref={pagesEl} className="pdf-pages" style={{ gap: GAP, width: Math.max(width + 32, fit + 32) }}>
            {ratios.map((r, k) => <PageView key={k} doc={doc} n={k + 1} width={width} ratio={r} root={scroller} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Una pagina: segnaposto con le proporzioni giuste, disegnata quando è vicina allo schermo. */
function PageView({ doc, n, width, ratio, root }: { doc: PdfDoc; n: number; width: number; ratio: number; root: React.RefObject<HTMLDivElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root: root.current, rootMargin: "1200px 0px" });
    io.observe(box.current!);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    const c = canvas.current!;
    if (!near) {
      // Lontana dallo schermo: libera la memoria del canvas.
      c.width = c.height = 0;
      setDrawn(0);
      return;
    }
    let task: { promise: Promise<void>; cancel(): void } | null = null, alive = true;
    // Breve attesa: durante uno zoom continuo si disegna solo alla fine.
    const t = setTimeout(async () => {
      const page = await doc.getPage(n);
      if (!alive) return;
      // Disegna su un canvas nuovo e sostituisce alla fine: niente pagina bianca durante lo zoom.
      const off = document.createElement("canvas");
      task = renderPage(page, off, width);
      try {
        await task.promise;
        if (!alive) return;
        c.width = off.width;
        c.height = off.height;
        c.getContext("2d")!.drawImage(off, 0, 0);
        setDrawn(width);
      } catch { /* annullato */ }
    }, drawn ? 150 : 0);
    return () => { alive = false; clearTimeout(t); task?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, width, doc, n]);

  return (
    <div ref={box} data-page={n} className="pdf-page" style={{ width, height: Math.round(width * ratio) }}>
      <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block", opacity: drawn ? 1 : 0 }} />
    </div>
  );
}
