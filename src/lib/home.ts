/** Riquadri della Home e loro disposizione (ordine, dimensione, visibilità), salvata in `settings.home`. */

export type WidgetSize = "s" | "m" | "l";
export const SIZE_SPAN: Record<WidgetSize, number> = { s: 4, m: 6, l: 12 };
export const SIZE_LABEL: Record<WidgetSize, string> = { s: "Piccolo", m: "Medio", l: "Largo" };

export const WIDGETS = {
  insights: { title: "Suggerimenti dell'IA", href: null, desc: "Ogni mattina l'IA nota cose utili (note senza progetto, persone da risentire, progetti fermi…) e propone azioni da confermare." },
  news: { title: "Notizie per te", href: null, desc: "Notizie dal mondo sui tuoi argomenti e, con l'IA, su quelli della tua memoria. Si catturano in Inbox." },
  weather: { title: "Meteo", href: null, desc: "Condizioni attuali e previsioni, con animazioni. Luogo e dettagli configurabili." },
  inbox: { title: "Catture recenti", href: "/inbox", desc: "Le ultime catture: prima quelle da confermare, poi quelle già in memoria." },
  tasks: { title: "Attività in arrivo", href: "/attivita", desc: "Le prossime scadenze." },
  projects: { title: "Progetti attivi", href: "/progetti", desc: "Avanzamento e prossima milestone." },
  knowledge: { title: "Conoscenza recente", href: "/conoscenza", desc: "Gli ultimi elementi in memoria." },
  people: { title: "Persone", href: "/persone", desc: "Le persone della tua memoria." },
  agenda: { title: "Agenda di oggi", href: "/attivita", desc: "Attività di oggi con orario e promemoria." },
  goals: { title: "Obiettivi aperti", href: "/progetti", desc: "Gli obiettivi da raggiungere, per progetto." },
  favorites: { title: "Preferiti", href: "/conoscenza", desc: "Gli elementi segnati con la stella." },
  chats: { title: "Conversazioni recenti", href: "/assistente", desc: "Le ultime conversazioni con l'Assistente." },
} as const;
export type WidgetId = keyof typeof WIDGETS;

export type HomeWidget = { id: WidgetId; size: WidgetSize; hidden: boolean };
export type HomeLayout = { summary: boolean; widgets: HomeWidget[] };

/** La Home di sempre; i riquadri nuovi partono nascosti e si aggiungono da "Personalizza". */
export const DEFAULT_HOME: HomeLayout = {
  summary: true,
  widgets: [
    { id: "insights", size: "l", hidden: false },
    { id: "weather", size: "m", hidden: false },
    { id: "news", size: "m", hidden: false },
    { id: "inbox", size: "s", hidden: false },
    { id: "tasks", size: "s", hidden: false },
    { id: "projects", size: "s", hidden: false },
    { id: "knowledge", size: "m", hidden: false },
    { id: "people", size: "m", hidden: false },
    { id: "agenda", size: "s", hidden: true },
    { id: "goals", size: "s", hidden: true },
    { id: "favorites", size: "s", hidden: true },
    { id: "chats", size: "s", hidden: true },
  ],
};

/** Riquadri nuovi che compaiono subito (in testa) anche in una Home già personalizzata. */
const SHOW_WHEN_NEW = new Set<string>(["weather", "news", "insights"]);

/** Normalizza la disposizione salvata: scarta i riquadri sconosciuti e aggiunge in fondo, nascosti, quelli nuovi. */
export function parseHome(raw: string | null | undefined): HomeLayout {
  let v: Partial<HomeLayout> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { /* disposizione predefinita */ }
  const seen = new Set<string>();
  const widgets: HomeWidget[] = [];
  for (const w of Array.isArray(v.widgets) ? v.widgets : []) {
    if (!w || !(w.id in WIDGETS) || seen.has(w.id)) continue;
    seen.add(w.id);
    widgets.push({ id: w.id, size: w.size === "m" || w.size === "l" ? w.size : "s", hidden: !!w.hidden });
  }
  // Con una disposizione già salvata, i riquadri che non conosceva arrivano nascosti; senza, vale quella predefinita.
  const stored = widgets.length > 0;
  for (const d of DEFAULT_HOME.widgets) {
    if (seen.has(d.id)) continue;
    if (stored && SHOW_WHEN_NEW.has(d.id)) widgets.unshift({ ...d, hidden: false });
    else widgets.push({ ...d, hidden: stored ? true : d.hidden });
  }
  return { summary: v.summary !== false, widgets };
}
