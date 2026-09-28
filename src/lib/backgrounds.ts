/**
 * Sfondi dell'app: motivi preimpostati (CSS e SVG, colorati con l'accento del tema) e immagini caricate.
 * Condiviso tra server (CSS del tema, nessuno sfarfallio) e client (anteprime e modifiche dal vivo).
 */

export type Bg = { id: string; strength: number };
export const NO_BG: Bg = { id: "none", strength: 50 };

/** Proprietà CSS di un livello di sfondo; `mask` usa un SVG come stampo riempito con il colore d'accento. */
type Layer = { background?: string; backgroundSize?: string; backgroundPosition?: string; mask?: string; maskSize?: string };

const svg = (w: number, h: number, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

const A = "var(--color-accent)";
const T = "var(--color-text)";
const mix = (c: string, pct: number, b = "transparent") => `color-mix(in srgb, ${c} ${pct}%, ${b})`;

export const BG_PRESETS: { id: string; name: string; layer: Layer }[] = [
  { id: "dots", name: "Puntinato", layer: { background: `radial-gradient(${A} 1.3px, transparent 1.8px)`, backgroundSize: "22px 22px" } },
  { id: "grid", name: "Griglia", layer: {
    background: `linear-gradient(${mix(T, 35)} 1px, transparent 1px), linear-gradient(90deg, ${mix(T, 35)} 1px, transparent 1px)`,
    backgroundSize: "32px 32px",
  } },
  { id: "blueprint", name: "Progetto", layer: {
    background: [
      `linear-gradient(${A} 1px, transparent 1px)`, `linear-gradient(90deg, ${A} 1px, transparent 1px)`,
      `linear-gradient(${mix(A, 40)} 1px, transparent 1px)`, `linear-gradient(90deg, ${mix(A, 40)} 1px, transparent 1px)`,
    ].join(", "),
    backgroundSize: "120px 120px, 120px 120px, 24px 24px, 24px 24px",
  } },
  { id: "lines", name: "Diagonali", layer: { background: `repeating-linear-gradient(45deg, ${A} 0 1px, transparent 1px 14px)` } },
  { id: "waves", name: "Onde", layer: {
    mask: svg(120, 40, `<path d='M0 20 Q15 5 30 20 T60 20 T90 20 T120 20' fill='none' stroke='black' stroke-width='1.5'/>`), maskSize: "120px 40px",
  } },
  { id: "topo", name: "Topografico", layer: {
    mask: svg(300, 300, [
      "M-10 60 C60 20 120 110 190 70 S280 30 310 80", "M-10 120 C70 80 130 170 200 130 S290 90 310 140",
      "M-10 180 C50 150 140 230 210 190 S280 160 310 200", "M-10 240 C80 210 120 290 200 250 S270 220 310 260",
      "M40 -10 C60 40 20 80 60 120", "M250 170 C230 210 280 250 240 310",
    ].map((d) => `<path d='${d}' fill='none' stroke='black' stroke-width='1.2'/>`).join("")),
    maskSize: "300px 300px",
  } },
  { id: "hex", name: "Esagoni", layer: {
    mask: svg(56, 98, `<path d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 98M28 0L28 -34' fill='none' stroke='black' stroke-width='1.2'/>`), maskSize: "56px 98px",
  } },
  { id: "plus", name: "Crocette", layer: {
    mask: svg(40, 40, `<path d='M20 14V26M14 20H26' stroke='black' stroke-width='1.5'/>`), maskSize: "40px 40px",
  } },
  { id: "circles", name: "Cerchi", layer: {
    mask: svg(80, 80, `<circle cx='40' cy='40' r='22' fill='none' stroke='black' stroke-width='1.2'/><circle cx='0' cy='0' r='22' fill='none' stroke='black' stroke-width='1.2'/><circle cx='80' cy='0' r='22' fill='none' stroke='black' stroke-width='1.2'/><circle cx='0' cy='80' r='22' fill='none' stroke='black' stroke-width='1.2'/><circle cx='80' cy='80' r='22' fill='none' stroke='black' stroke-width='1.2'/>`),
    maskSize: "80px 80px",
  } },
  { id: "aurora", name: "Aurora", layer: {
    background: [
      `radial-gradient(55% 45% at 12% 18%, ${mix(A, 70)}, transparent 70%)`,
      `radial-gradient(45% 55% at 88% 22%, ${mix(A, 55, "#ff7a59")}, transparent 70%)`,
      `radial-gradient(60% 50% at 70% 95%, ${mix(A, 60, "#2fc4b2")}, transparent 70%)`,
      `radial-gradient(40% 40% at 25% 85%, ${mix(A, 50, "#f5c542")}, transparent 70%)`,
    ].join(", "),
  } },
  { id: "dusk", name: "Tramonto", layer: {
    background: `linear-gradient(160deg, ${mix(A, 70)} 0%, transparent 45%), linear-gradient(340deg, ${mix(A, 45, "#ff6b6b")} 0%, transparent 55%)`,
  } },
  { id: "grain", name: "Grana", layer: {
    mask: svg(160, 160, `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.2 1.4'/></filter><rect width='160' height='160' filter='url(#n)'/>`),
    maskSize: "160px 160px",
  } },
];

export const isUpload = (id: string) => id.startsWith("up:");
export const uploadUrl = (id: string) => `/api/backgrounds/${id.slice(3)}`;

/** Livello per un id di sfondo (preimpostato o caricato); null se nessuno. */
export function bgLayer(id: string): Layer | null {
  if (isUpload(id)) return { background: `url("${uploadUrl(id)}") center / cover no-repeat` };
  return BG_PRESETS.find((p) => p.id === id)?.layer ?? null;
}

/** Stile React per le anteprime. */
export function bgPreviewStyle(id: string): Record<string, string> {
  const l = bgLayer(id);
  if (!l) return {};
  if (l.mask) return { background: A, WebkitMaskImage: l.mask, maskImage: l.mask, WebkitMaskSize: l.maskSize ?? "auto", maskSize: l.maskSize ?? "auto" };
  return { background: l.background ?? "", backgroundSize: l.backgroundSize ?? "", backgroundPosition: l.backgroundPosition ?? "" };
}

/** CSS del livello di sfondo dietro il contenuto dell'app (in .sb-root, sotto la barra laterale). */
export function bgCss(bg: Bg): string {
  const l = bgLayer(bg.id);
  if (!l) return "";
  const decl = l.mask
    ? `background:${A};-webkit-mask-image:${l.mask};mask-image:${l.mask};-webkit-mask-size:${l.maskSize};mask-size:${l.maskSize}`
    : `background:${l.background}${l.backgroundSize ? `;background-size:${l.backgroundSize}` : ""}`;
  // Al massimo 60% per i motivi e 75% per le immagini: il testo sopra deve restare leggibile.
  const opacity = (bg.strength / 100) * (isUpload(bg.id) ? 0.75 : 0.6);
  return [
    `[data-sb] .sb-root{isolation:isolate}`,
    `[data-sb] .sb-root::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;${decl};opacity:${opacity.toFixed(3)}}`,
  ].join("\n");
}

export function parseBg(v: unknown): Bg {
  const b = (v ?? {}) as Partial<Bg>;
  const id = typeof b.id === "string" && (b.id === "none" || BG_PRESETS.some((p) => p.id === b.id) || /^up:[a-z0-9_]{1,40}$/.test(b.id)) ? b.id : "none";
  const strength = typeof b.strength === "number" && b.strength >= 0 && b.strength <= 100 ? Math.round(b.strength) : NO_BG.strength;
  return { id, strength };
}
