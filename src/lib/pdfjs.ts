/**
 * Caricamento di pdf.js (solo nel browser). La libreria è copiata in public/pdfjs (vedi README.txt lì):
 * npm install su Google Drive si rompe, e così resta fuori dal bundle finché non serve.
 */

export type PdfViewport = { width: number; height: number };
export type PdfPage = {
  getViewport(o: { scale: number }): PdfViewport;
  render(o: { canvasContext: CanvasRenderingContext2D; canvas: HTMLCanvasElement; viewport: PdfViewport }): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
};
export type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage> };
export type PdfTask = { promise: Promise<PdfDoc>; destroy(): Promise<void> };
type PdfLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(o: Record<string, unknown>): PdfTask;
};

const BASE = "/pdfjs/";
let lib: Promise<PdfLib> | null = null;

function pdfjs() {
  lib ??= (import(/* webpackIgnore: true */ `${BASE}pdf.min.mjs`) as Promise<PdfLib>).then((m) => {
    m.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.mjs`;
    return m;
  });
  lib.catch(() => { lib = null; });
  return lib;
}

/**
 * Apre un PDF dall'indirizzo (stessa origine, con i cookie di sessione).
 * `close()` libera il documento e il worker (in pdf.js 6 lo fa il task, non il documento).
 */
export function openPdf(url: string) {
  let task: PdfTask | null = null, closed = false;
  const promise = pdfjs().then((m) => {
    if (closed) throw new Error("chiuso");
    task = m.getDocument({
      url,
      withCredentials: true,
      cMapUrl: `${BASE}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${BASE}standard_fonts/`,
      wasmUrl: `${BASE}wasm/`,
    });
    return task.promise;
  });
  return { promise, close: () => { closed = true; task?.destroy(); } };
}

/** Disegna una pagina su un canvas alla larghezza CSS indicata (nitida sugli schermi ad alta densità). */
export function renderPage(page: PdfPage, canvas: HTMLCanvasElement, cssWidth: number) {
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${(cssWidth * base.height) / base.width}px`;
  return page.render({ canvasContext: canvas.getContext("2d")!, canvas, viewport });
}
