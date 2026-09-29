/**
 * Riconosce le richieste di «quadro completo» (scritte o dettate) e ne estrae l'argomento:
 * «fammi il quadro completo di Progetto Alpha», «quadro generale su Marco», «fammi il punto della situazione sul trasloco».
 * Condiviso tra browser (Assistente, barra ⌘J) e server.
 */
// Le forme più lunghe prima: «sul» non deve fermarsi a «su», «dell'» a «del».
const PREP = ["riguardo a", "riguardo", "dell'", "della", "dello", "degli", "delle", "sull'", "sulla", "sullo", "sugli", "sulle", "del", "dei", "sul", "sui", "per", "di", "su"]
  .map((p) => p.replace(/ /g, "\\s+")).join("|");
const ASK = "(?:(?:mi\\s+)?(?:fammi\\s+vedere|puoi\\s+farmi|potresti\\s+farmi|fammi|dammi|mostrami|preparami|prepara|vorrei|voglio|fai|serve)\\s+)?";
const FULL = "(?:quadro\\s+(?:completo|generale|d'insieme|della\\s+situazione)|punto\\s+della\\s+situazione)";
const RE = new RegExp(
  // Dopo «quadro completo» la preposizione può mancare («quadro completo #pricing»); dopo «quadro» da solo no.
  `^\\s*${ASK}(?:(?:il|un)\\s+)?(?:${FULL}\\s*(?:(?:${PREP})\\s*)?|quadro\\s+(?:${PREP})\\s*)(.+?)[\\s?.!]*$`,
  "i",
);

export function overviewTopic(text: string): string | null {
  const m = text.replace(/\s+/g, " ").match(RE);
  const t = m?.[1]?.trim().replace(/^["«']|["»']$/g, "").trim();
  return t && t.length >= 2 && t.length <= 120 ? t : null;
}

export const overviewHref = (topic: string) => `/quadro?t=${encodeURIComponent(topic)}`;
