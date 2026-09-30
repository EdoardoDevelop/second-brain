// Regole pure (niente database né IA): riconoscimento delle richieste, età dei fatti, abitudini, scadenze.
import { test } from "node:test";
import assert from "node:assert/strict";
import { overviewTopic } from "../src/lib/overview-topic";
import { confirmedAgo, factAge } from "../src/lib/fact-age";
import { cadenceLabel, cadenceOf, cleanLabel, nextDate, sameSeries } from "../src/lib/habits";
import { dueLabel, isoDay } from "../src/lib/format";
import { speechText } from "../src/lib/speech";
import { isExcluded, parseNewsConfig } from "../src/lib/news";

const DAY = 86400000;

test("quadro completo: riconosce la richiesta e l'argomento", () => {
  assert.equal(overviewTopic("fammi il quadro completo di Progetto Alpha"), "Progetto Alpha");
  assert.equal(overviewTopic("Fammi il quadro completo su Marco Rinaldi?"), "Marco Rinaldi");
  assert.equal(overviewTopic("dammi il punto della situazione sul round seed"), "round seed");
  assert.equal(overviewTopic("puoi farmi il quadro completo dell'onboarding"), "onboarding");
  assert.equal(overviewTopic("quadro completo #pricing"), "#pricing");
  assert.equal(overviewTopic("Quadro completo di «Cambiare lavoro»"), "Cambiare lavoro");
  assert.equal(overviewTopic("quadro di Marco"), "Marco");
});

test("quadro completo: non scatta sulle frasi normali", () => {
  assert.equal(overviewTopic("cosa devo fare oggi"), null);
  assert.equal(overviewTopic("il quadro elettrico va sistemato"), null);
  assert.equal(overviewTopic("aggiungi il quadro in soggiorno alle attività"), null);
});

test("età dei fatti: fresco, vecchio, forse superato", () => {
  const now = Date.now();
  assert.equal(factAge(now - 10 * DAY, now - 400 * DAY, now).age, "fresh");
  assert.equal(factAge(now - 120 * DAY, now - 400 * DAY, now).age, "old");
  assert.equal(factAge(now - 200 * DAY, now - 400 * DAY, now).age, "stale");
  // Senza conferme vale la data di creazione.
  assert.equal(factAge(null, now - 95 * DAY, now).age, "old");
  assert.equal(confirmedAgo(0), "confermato oggi");
  assert.equal(confirmedAgo(1), "confermato ieri");
  assert.equal(confirmedAgo(12), "confermato 12 giorni fa");
  assert.equal(confirmedAgo(210), "confermato 7 mesi fa");
});

test("abitudini: riconosce i ritmi", () => {
  const weekly = cadenceOf(["2026-08-26", "2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23"]);
  assert.deepEqual(weekly, { kind: "weekly", weekday: 3 });
  assert.equal(cadenceLabel(weekly!), "ogni mercoledì");
  assert.equal(cadenceOf(["2026-07-06", "2026-07-20", "2026-08-03", "2026-08-17"])?.kind, "biweekly");
  assert.deepEqual(cadenceOf(["2026-07-01", "2026-08-01", "2026-09-01"]), { kind: "monthly", day: 1 });
  assert.deepEqual(cadenceOf(["2026-09-01", "2026-09-04", "2026-09-07", "2026-09-10"]), { kind: "every", every: 3 });
  // Irregolare: nessun ritmo.
  assert.equal(cadenceOf(["2026-08-03", "2026-08-21", "2026-08-24", "2026-09-17"]), null);
  // Troppo poche volte.
  assert.equal(cadenceOf(["2026-09-02", "2026-09-09"]), null);
});

test("abitudini: prossima volta attesa", () => {
  assert.equal(nextDate({ kind: "weekly", weekday: 3 }, "2026-09-23", "2026-09-29"), "2026-09-30");
  assert.equal(nextDate({ kind: "monthly", day: 1 }, "2026-09-01", "2026-09-29"), "2026-10-01");
  // Il 31 in un mese corto diventa l'ultimo giorno.
  assert.equal(nextDate({ kind: "monthly", day: 31 }, "2026-01-31", "2026-02-01"), "2026-02-28");
  assert.equal(nextDate({ kind: "every", every: 3 }, "2026-09-10", "2026-09-12"), "2026-09-13");
});

test("abitudini: etichette e serie", () => {
  assert.equal(cleanLabel("Report settimanale al cliente 23/09"), "Report settimanale al cliente");
  assert.equal(cleanLabel("Riunione di reparto del 23/9"), "Riunione di reparto");
  assert.equal(cleanLabel("Verbale - 12.10.2026"), "Verbale");
  assert.equal(cleanLabel("Pagare l'affitto"), "Pagare l'affitto");
  assert.ok(sameSeries("Report settimanale al cliente 16/09", "Report settimanale al cliente"));
  assert.ok(!sameSeries("Report settimanale al cliente", "Pagare l'affitto"));
});

test("scadenze: l'anno compare solo se non è quello corrente", () => {
  const year = Number(isoDay().slice(0, 4));
  assert.ok(!dueLabel(`${year}-12-31`).includes(String(year)) || isoDay() === `${year}-12-31`);
  assert.ok(dueLabel(`${year + 1}-03-31`).endsWith(String(year + 1)));
  assert.equal(dueLabel(isoDay()), "Oggi");
});

test("lettura ad alta voce: niente citazioni, grassetti, elenchi e indirizzi", () => {
  assert.equal(speechText("Il **Poco F6 Pro** ⟦it_123⟧ va bene.\n\n- batteria\n- schermo https://example.com/x [[FINE]]"), "Il Poco F6 Pro va bene. batteria, schermo link");
});

test("notizie: argomenti esclusi a parole intere, con singolare e plurale", () => {
  const no = ["calcio", "elezione", "Belen Rodriguez"];
  assert.equal(isExcluded("Serie A, il calcio italiano in crisi", no), true);
  assert.equal(isExcluded("Càlcio: risultati", no), true);
  assert.equal(isExcluded("Elezioni regionali, i risultati", no), true);
  assert.equal(isExcluded("Gossip: Belén Rodríguez in vacanza", no), true);
  assert.equal(isExcluded("Il calciatore dell'anno", no), false);
  assert.equal(isExcluded("Calcium, nuovo framework", no), false);
  assert.equal(isExcluded("Qualsiasi titolo", []), false);
  assert.deepEqual(parseNewsConfig(JSON.stringify({ topics: ["IA"] })).excluded, []);
  assert.deepEqual(parseNewsConfig(JSON.stringify({ excluded: [" gossip ", "Gossip", ""] })).excluded, ["gossip"]);
});
