/**
 * Sistema dei temi. Un "look" (stile, accento, sfondo, font, arrotondamento) genera tutte le variabili CSS
 * per la modalità chiara e scura. Condiviso tra server (nessuno sfarfallio al caricamento) e client (anteprima dal vivo).
 * Il look è salvato nel database, quindi è lo stesso su tutti i dispositivi; chiaro/scuro/automatico è per dispositivo (cookie).
 */

import { bgCss, NO_BG, parseBg, type Bg } from "./backgrounds";

export type Mode = "light" | "dark" | "auto";

export const FONTS = {
  barlow: { name: "Barlow", sample: "Industriale, compatto", heading: '"Barlow Condensed"', body: '"Barlow"', weight: 600, google: "family=Barlow:wght@400;500;700&family=Barlow+Condensed:wght@400;600" },
  inter: { name: "Inter", sample: "Neutro, moderno", heading: '"Inter"', body: '"Inter"', weight: 600, google: "family=Inter:wght@400;500;600;700" },
  plex: { name: "IBM Plex", sample: "Tecnico, leggibile", heading: '"IBM Plex Sans"', body: '"IBM Plex Sans"', weight: 600, google: "family=IBM+Plex+Sans:wght@400;500;600" },
  grotesk: { name: "Space Grotesk", sample: "Geometrico, con carattere", heading: '"Space Grotesk"', body: '"Inter"', weight: 600, google: "family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600" },
  serif: { name: "Serif editoriale", sample: "Da rivista, per leggere", heading: '"Source Serif 4"', body: '"Source Sans 3"', weight: 600, google: "family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&family=Source+Sans+3:wght@400;500;600" },
  roboto: { name: "Roboto", sample: "Quello di Material", heading: '"Roboto"', body: '"Roboto"', weight: 500, google: "family=Roboto:wght@400;500;700" },
  system: { name: "Di sistema", sample: "Quello del dispositivo", heading: "system-ui", body: "system-ui", weight: 600, google: null },
} as const;
export type FontKey = keyof typeof FONTS;

type Neutrals = { bg: string; surface: string; sidebar: string; raised: string; text: string };
/** `tonal`: le superfici sono tinte con il colore d'accento, come in Material You (i valori statici servono solo alle anteprime). */
export const TINTS: Record<string, { name: string; light: Neutrals; dark: Neutrals; tonal?: boolean }> = {
  tonal: { name: "Tonale", tonal: true, light: { bg: "#fdf8fd", surface: "#f1ecf4", sidebar: "#f7f2fa", raised: "#ffffff", text: "#1c1b1f" }, dark: { bg: "#141218", surface: "#211f26", sidebar: "#0f0d13", raised: "#2b2930", text: "#e6e0e9" } },
  neutral: { name: "Neutro", light: { bg: "#f2f2f3", surface: "#e9e9ea", sidebar: "#ebebed", raised: "#f7f7f8", text: "#1d1f20" }, dark: { bg: "#121416", surface: "#1a1d20", sidebar: "#0e1012", raised: "#1b1e22", text: "#dde0e3" } },
  warm: { name: "Caldo", light: { bg: "#f5f1eb", surface: "#ece6dd", sidebar: "#eee8df", raised: "#faf7f2", text: "#231f1a" }, dark: { bg: "#171411", surface: "#201c18", sidebar: "#110f0c", raised: "#231f1b", text: "#e7e0d6" } },
  cool: { name: "Freddo", light: { bg: "#eff2f6", surface: "#e4e9f0", sidebar: "#e7ebf1", raised: "#f6f8fb", text: "#1a1f26" }, dark: { bg: "#0f131a", surface: "#161c25", sidebar: "#0a0d12", raised: "#19202b", text: "#dce3ec" } },
  green: { name: "Verde", light: { bg: "#eff3f0", surface: "#e3eae5", sidebar: "#e6ede8", raised: "#f6f9f7", text: "#1b211d" }, dark: { bg: "#101512", surface: "#171e1a", sidebar: "#0b0f0d", raised: "#1a221d", text: "#dce5df" } },
  plum: { name: "Prugna", light: { bg: "#f3f0f5", surface: "#e9e4ee", sidebar: "#ece7f0", raised: "#f9f7fb", text: "#201c24" }, dark: { bg: "#141119", surface: "#1c1822", sidebar: "#0e0c12", raised: "#1f1b26", text: "#e4dfea" } },
  black: { name: "Profondo", light: { bg: "#f7f7f7", surface: "#eeeeee", sidebar: "#f0f0f0", raised: "#ffffff", text: "#161616" }, dark: { bg: "#050505", surface: "#101010", sidebar: "#000000", raised: "#141414", text: "#e8e8e8" } },
};
export type TintKey = keyof typeof TINTS;

export const RADII = [["0", "Squadrato"], ["4", "Leggero"], ["8", "Morbido"], ["14", "Arrotondato"]] as const;

export const ACCENTS = ["#5980a6", "#3d7ea6", "#3f8a6b", "#7c6cd6", "#b0643c", "#d0545f", "#c28a1e", "#4a4a4a"] as const;

export const STYLES = [["industry", "Industry"], ["material", "Material"]] as const;
export type StyleKey = (typeof STYLES)[number][0];

/** Parte del look definita dai temi preimpostati; lo sfondo (`bg`) resta quello scelto. */
export type LookBase = { style: StyleKey; accent: string; tint: TintKey; font: FontKey; radius: number };
export type Look = LookBase & { bg: Bg };

export const PRESETS: { id: string; name: string; look: LookBase }[] = [
  { id: "industry", name: "Industry", look: { style: "industry", accent: "#5980a6", tint: "neutral", font: "barlow", radius: 0 } },
  { id: "material", name: "Material", look: { style: "material", accent: "#6750a4", tint: "tonal", font: "roboto", radius: 14 } },
  { id: "carta", name: "Carta", look: { style: "industry", accent: "#b0643c", tint: "warm", font: "serif", radius: 4 } },
  { id: "foresta", name: "Foresta", look: { style: "industry", accent: "#3f8a6b", tint: "green", font: "plex", radius: 6 } },
  { id: "lavanda", name: "Lavanda", look: { style: "industry", accent: "#7c6cd6", tint: "plum", font: "inter", radius: 10 } },
  { id: "oceano", name: "Oceano", look: { style: "industry", accent: "#3d7ea6", tint: "cool", font: "grotesk", radius: 8 } },
  { id: "inchiostro", name: "Inchiostro", look: { style: "industry", accent: "#4a4a4a", tint: "black", font: "system", radius: 14 } },
];

export const DEFAULT_LOOK: Look = { ...PRESETS[0]!.look, bg: NO_BG };

/** Normalizza un look letto da database o cookie: valori mancanti o non validi tornano al predefinito. */
export function parseLook(raw: string | null | undefined): Look {
  let v: Partial<Look> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { /* look predefinito */ }
  return {
    style: v.style === "material" ? "material" : "industry",
    accent: typeof v.accent === "string" && /^#[0-9a-f]{6}$/i.test(v.accent) ? v.accent.toLowerCase() : DEFAULT_LOOK.accent,
    tint: v.tint && v.tint in TINTS ? v.tint : DEFAULT_LOOK.tint,
    font: v.font && v.font in FONTS ? v.font : DEFAULT_LOOK.font,
    radius: typeof v.radius === "number" && v.radius >= 0 && v.radius <= 20 ? Math.round(v.radius) : DEFAULT_LOOK.radius,
    bg: parseBg(v.bg),
  };
}

export const presetOf = (l: Look) => PRESETS.find((p) => p.look.style === l.style && p.look.accent === l.accent && p.look.tint === l.tint && p.look.font === l.font && p.look.radius === l.radius)?.id ?? null;

export const fontUrl = (f: FontKey) => (FONTS[f].google ? `https://fonts.googleapis.com/css2?${FONTS[f].google}&display=swap` : null);

const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

/** Colori di sfondo e testo; con la tinta tonale sono calcolati dall'accento (valori CSS color-mix). */
export function neutrals(l: Pick<Look, "accent" | "tint">, dark: boolean): Neutrals {
  const t = TINTS[l.tint]!;
  if (!t.tonal) return t[dark ? "dark" : "light"];
  const a = l.accent;
  return dark
    ? { bg: mix(a, 6, "#121115"), surface: mix(a, 11, "#1a191d"), sidebar: mix(a, 4, "#0e0d10"), raised: mix(a, 14, "#222126"), text: "#e6e1e8" }
    : { bg: mix(a, 5, "#fdfcff"), surface: mix(a, 11, "#f6f5fa"), sidebar: mix(a, 8, "#fbfaff"), raised: mix(a, 2, "#ffffff"), text: "#1c1b1f" };
}

function tokens(l: Look, dark: boolean) {
  const n = neutrals(l, dark);
  const t = n.text;
  // In scuro l'accento si schiarisce per restare leggibile sullo sfondo.
  const a = dark ? mix(l.accent, 72, "white") : l.accent;
  const v: Record<string, string> = {
    "--color-bg": n.bg, "--color-surface": n.surface, "--color-text": t, "--sidebar": n.sidebar, "--raised": n.raised,
    "--color-accent": a, "--color-accent-2": a,
    "--color-accent-400": dark ? mix(l.accent, 55, "white") : mix(l.accent, 70, "white"),
    "--color-accent-600": dark ? mix(l.accent, 60, "white") : mix(l.accent, 88, "black"),
    "--color-accent-700": dark ? mix(l.accent, 40, "white") : mix(l.accent, 72, "black"),
    "--accent-text": dark ? mix(l.accent, 50, "white") : mix(l.accent, 72, "black"),
    "--color-divider": mix(t, dark ? 13 : 16, "transparent"),
    "--hover": mix(t, dark ? 6 : 5, "transparent"),
    // In Material la selezione è il "secondary container": un riempimento tonale più deciso.
    "--sel": mix(a, l.style === "material" ? (dark ? 30 : 20) : dark ? 17 : 14, "transparent"),
    "--muted": mix(t, dark ? 62 : 64, "transparent"),
    "--faint": mix(t, dark ? 36 : 38, "transparent"),
    "--skel": mix(t, 8, "transparent"),
    "--danger": dark ? "#e39a90" : "#a4473f",
    "--danger-bg": mix(dark ? "#e39a90" : "#a4473f", dark ? 12 : 10, "transparent"),
    "--shadow-lg": dark ? "0 18px 48px rgba(0,0,0,.55)" : `0 12px 32px ${mix(t, 22, "transparent")}`,
  };
  return Object.entries(v).map(([k, x]) => `${k}:${x}`).join(";");
}

/** CSS completo del tema: variabili comuni, chiaro, scuro e automatico (segue il dispositivo). */
export function themeCss(l: Look): string {
  const f = FONTS[l.font];
  const r = l.radius;
  const light = tokens(l, false), dark = tokens(l, true);
  const rounded = ".btn,.input,.card,.tag,.seg,.dialog,.seg-sb,.chip,.source-chip,.suggestion,.scope-btn,.alert,.toast,.empty,.sb-search,.sb-nav-btn,.side-row,.kbd,.sb-badge,textarea,select";
  return [
    `[data-sb]{--font-heading:${f.heading},system-ui,sans-serif;--font-body:${f.body},system-ui,sans-serif;--font-heading-weight:${f.weight};--r:${r}px;--radius-sm:${Math.round(r / 2)}px;--radius-md:${r}px;--radius-lg:${Math.round(r * 1.5)}px}`,
    `[data-sb] :is(${rounded}){border-radius:${r}px}`,
    `[data-sb] .seg-sb{overflow:hidden}`,
    l.style === "material" ? materialCss(r) : "",
    `[data-sb][data-theme="light"]{${light};color-scheme:light}`,
    `[data-sb][data-theme="dark"]{${dark};color-scheme:dark}`,
    `@media (prefers-color-scheme: light){[data-sb][data-theme="auto"]{${light};color-scheme:light}}`,
    `@media (prefers-color-scheme: dark){[data-sb][data-theme="auto"]{${dark};color-scheme:dark}}`,
    bgCss(l.bg),
  ].join("\n");
}

/**
 * Stile Material (ispirato a Material Design 3): pulsanti a pillola, contenitori pieni e arrotondati senza segni d'angolo,
 * voce di menu attiva a pillola, selettori con riempimento tonale, campi con bordo che si ispessisce al focus.
 */
function materialCss(r: number) {
  const card = Math.max(r, 12);
  return [
    `[data-sb] :is(.btn,.seg-sb,.sb-nav-btn,.side-row,.scope-btn,.sb-search){border-radius:999px}`,
    `[data-sb] .btn{font-weight:500;letter-spacing:.01em;padding-inline:20px}`,
    `[data-sb] .btn.btn-icon{padding-inline:0}`,
    `[data-sb] .btn-primary{box-shadow:none}`,
    `[data-sb] .btn-primary:hover{box-shadow:0 1px 3px color-mix(in srgb,#000 22%,transparent)}`,
    `[data-sb] .btn-secondary{border-color:var(--color-divider)}`,
    `[data-sb] .seg-sb button[aria-pressed="true"]{background:var(--sel);color:var(--color-text)}`,
    `[data-sb] .seg-sb button{padding-inline:14px}`,
    `[data-sb] .sb-nav-btn[aria-current="page"]::before{display:none}`,
    `[data-sb] .sb-nav-btn[aria-current="page"]{font-weight:500}`,
    `[data-sb] .sb-badge{border-radius:999px}`,
    `[data-sb] .blueprint{background:var(--color-surface);border-color:transparent;border-radius:${card}px}`,
    `[data-sb] .blueprint > .corner{display:none}`,
    `[data-sb] :is(.card,.empty,.alert,.toast,.dialog){border-radius:${card}px}`,
    `[data-sb] :is(.suggestion,.chip,.source-chip,.tag,.kbd){border-radius:8px}`,
    `[data-sb] :is(input.input,textarea.input,select.input){border-radius:4px}`,
    `[data-sb] :is(input.input,textarea.input,select.input):focus{border-color:var(--color-accent);box-shadow:inset 0 0 0 1px var(--color-accent)}`,
    `[data-sb] .toast{box-shadow:0 4px 8px 3px color-mix(in srgb,#000 15%,transparent),0 1px 3px color-mix(in srgb,#000 30%,transparent)}`,
    `[data-sb] .check{border-radius:2px;border-width:2px}`,
    `[data-sb] .sb-side{border-right-color:transparent}`,
    `[data-sb] .sb-header{border-bottom-color:transparent}`,
  ].join("\n");
}

export const parseMode = (v: string | undefined): Mode => (v === "light" || v === "auto" ? v : "dark");
