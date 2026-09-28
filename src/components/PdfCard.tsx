"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";
import { openPdf, renderPage } from "@/lib/pdfjs";
import { showPdf } from "./PdfViewer";

const THUMB = 150;

/** Anteprima di un PDF allegato: prima pagina e numero di pagine; il clic apre il lettore integrato. */
export function PdfCard({ url, name }: { url: string; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let alive = true;
    const pdf = openPdf(url);
    pdf.promise.then(async (d) => {
      if (!alive) return;
      setPages(d.numPages);
      await renderPage(await d.getPage(1), canvas.current!, THUMB).promise;
      if (alive) setState("ok");
    }).catch(() => alive && setState("error"));
    return () => { alive = false; pdf.close(); };
  }, [url]);

  const open = () => showPdf(url, name);
  return (
    <div className="pdf-card">
      <button className="pdf-thumb" onClick={open} aria-label={`Apri ${name}`} title="Apri il PDF">
        <canvas ref={canvas} style={{ display: state === "ok" ? "block" : "none" }} />
        {state !== "ok" && <span className="muted" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 12 }}><Icon name="file" size={28} />PDF</span>}
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, justifyContent: "center" }}>
        <div className="ellipsis" style={{ fontSize: 15 }}>{name}</div>
        <div className="muted" style={{ fontSize: 13 }}>
          {state === "error" ? "Anteprima non disponibile" : pages == null ? "Carico l'anteprima…" : pages === 1 ? "1 pagina" : `${pages} pagine`}
        </div>
        <button className="btn btn-primary" onClick={open} style={{ alignSelf: "flex-start", gap: 6 }}><Icon name="book" />Leggi</button>
      </div>
    </div>
  );
}
