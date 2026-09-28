/** Profilo dell'utente: come chiamarlo, qualche informazione su di lui e il tono dell'IA. Salvato in `settings.profile`. */

export const TONES = {
  friendly: { label: "Amichevole", desc: "Caloroso e alla mano, come un amico che ti dà una mano." },
  neutral: { label: "Neutro", desc: "Cordiale ma asciutto, dritto al punto." },
  formal: { label: "Formale", desc: "Professionale, con il lei." },
} as const;
export type Tone = keyof typeof TONES;

export type Profile = { name: string; about: string; tone: Tone };
export const DEFAULT_PROFILE: Profile = { name: "", about: "", tone: "friendly" };

export function parseProfile(raw: string | null | undefined): Profile {
  let v: Partial<Profile> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { /* profilo vuoto */ }
  return {
    name: typeof v.name === "string" ? v.name.trim().slice(0, 60) : "",
    about: typeof v.about === "string" ? v.about.trim().slice(0, 1500) : "",
    tone: v.tone && v.tone in TONES ? v.tone : "friendly",
  };
}

/** Istruzioni di "personalità" aggiunte a tutte le chiamate all'IA. */
export function personaPrompt(p: Profile): string {
  const who = p.name
    ? `L'utente si chiama ${p.name}. Quando nei suoi testi compaiono "io", "me", "mio" o il suo nome, si riferiscono a lui: non va mai aggiunto tra le persone o i contatti.`
    : `Quando nei testi dell'utente compaiono "io", "me" o "mio", si riferiscono all'utente stesso: non va aggiunto tra le persone.`;
  const tone = {
    friendly: `Quando ti rivolgi all'utente (risposte, spiegazioni, riepiloghi scritti per lui) sii amichevole e caloroso, come un amico sveglio che lo conosce bene: dagli del tu${p.name ? `, chiamalo per nome ogni tanto (${p.name}), senza esagerare` : ""}, usa un italiano naturale e colloquiale, anche un pizzico di leggerezza o incoraggiamento quando ci sta. Niente formule burocratiche, niente "Gentile utente", niente lei. Resta comunque preciso e conciso: la simpatia non deve allungare le risposte.`,
    neutral: `Quando ti rivolgi all'utente sii cordiale e diretto: dagli del tu${p.name ? ` e, se serve, chiamalo ${p.name}` : ""}, senza fronzoli.`,
    formal: `Quando ti rivolgi all'utente usa un tono professionale e dagli del lei${p.name ? `; se serve chiamalo ${p.name}` : ""}.`,
  }[p.tone];
  const about = p.about ? `\nCose da sapere sull'utente (usale solo quando sono utili): ${p.about}` : "";
  return `${who}\n${tone}\nI contenuti che vengono archiviati (titoli, sintesi, testi delle note, attività) restano invece neutri e descrittivi, senza tono colloquiale.${about}`;
}
