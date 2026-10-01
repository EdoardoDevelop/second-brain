// Regole attorno all'IA (1/10): calendario per le date relative, diario riletto il giorno dopo, domande evidenti, attività doppie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDays, shiftToToday } from "../src/lib/format";

process.env.DATABASE_URL = ":memory:";

test("calendario: i prossimi giorni con il nome, dal fuso dell'utente", () => {
  // Giovedì 1 ottobre 2026, alle 23:30 a Roma (21:30 UTC).
  const d = nextDays(9, new Date(Date.UTC(2026, 9, 1, 21, 30)));
  assert.ok(d.startsWith("oggi giovedì 2026-10-01, domani venerdì 2026-10-02, sabato 2026-10-03"));
  assert.ok(d.endsWith("venerdì 2026-10-09"));
  // Cambio dell'ora legale (25 ottobre 2026): nessun giorno saltato o ripetuto.
  assert.ok(nextDays(3, new Date(Date.UTC(2026, 9, 24, 12))).includes("domenica 2026-10-25, lunedì 2026-10-26"));
});

test("diario di ieri riletto oggi: domani → oggi, oggi → ieri", () => {
  assert.equal(shiftToToday("Scelgo domani. Domani arriva un nuovo collega"), "Scelgo oggi. Oggi arriva un nuovo collega");
  assert.equal(shiftToToday("oggi ho visto Marco, stasera cena, dopodomani dentista"), "ieri ho visto Marco, ieri sera cena, domani dentista");
  assert.equal(shiftToToday("ieri pioveva"), "l'altro ieri pioveva");
  assert.equal(shiftToToday("odomani e oggigiorno"), "odomani e oggigiorno");
});

test("domande evidenti: dritte all'Assistente, i comandi no", async () => {
  const { plainQuestion } = await import("../src/lib/ai");
  for (const q of ["cosa devo fare oggi?", "chi è Lorenzo Properzi?", "a che punto sono con la casa?".replace("a che", "che"), "perché il progetto Casa è fermo?", "quali componenti zigbee ho salvato?", "mi ricordi cosa ho deciso per il camino?"])
    assert.equal(plainQuestion(q), true, q);
  for (const q of ["aggiungi che devo comprare il cartongesso e dimmi cosa ho sabato?", "ricordami domani alle 9 di chiamare il commercialista", "cosa devo fare oggi", "puoi segnare come fatta la scelta del telefono?", "chi è Martin? crea una scheda"])
    assert.equal(plainQuestion(q), false, q);
});

test("suggerimenti: riconosce un'attività già aperta detta con altre parole", async () => {
  const { sameTask } = await import("../src/lib/proactive");
  assert.equal(sameTask("Contattare Martin per cercare di prendere il lavoro", "Contattare Martin"), true);
  assert.equal(sameTask("Scegliere il telefono aziendale (budget circa 500€)", "Scegliere il telefono aziendale"), true);
  assert.equal(sameTask("Sentire Diego Bernardi", "Contattare Martin"), false);
  assert.equal(sameTask("Comprare il cartongesso", "Comprare il coordinatore Zigbee"), false);
});
