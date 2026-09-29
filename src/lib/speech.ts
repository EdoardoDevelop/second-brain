"use client";

import { useEffect, useState } from "react";

/**
 * Lettura ad alta voce con la sintesi vocale del dispositivo (Web Speech API): gratis e senza inviare il testo a nessuno.
 * Un solo testo alla volta; `key` dice quale (per il pulsante play/stop del messaggio giusto).
 */

let current: string | null = null;
const listeners = new Set<(k: string | null) => void>();
const setCurrent = (k: string | null) => { current = k; listeners.forEach((l) => l(k)); };

export const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

/** Toglie ciò che non va letto: citazioni ⟦id⟧, grassetti, trattini degli elenchi, indirizzi, marcatori [[…]]. */
export function speechText(s: string) {
  return s
    .replace(/⟦[^⟧]*⟧?/g, "")
    .replace(/\[\[[A-Z]+\]\]/g, "")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/\*\*|__|`|#+\s/g, "")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    // A capo = pausa: punto tra paragrafi, virgola tra le righe (elenchi), se non c'è già la punteggiatura.
    .replace(/([^.!?:;,\n])\n{2,}/g, "$1. ")
    .replace(/([^.!?:;,\n])\n/g, "$1, ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pezzi brevi: Chrome interrompe le frasi lunghe dopo circa 15 secondi. */
function chunks(s: string, max = 220): string[] {
  const out: string[] = [];
  let cur = "";
  for (const part of s.split(/(?<=[.!?;:])\s+/)) {
    if ((cur + " " + part).trim().length > max && cur) { out.push(cur.trim()); cur = ""; }
    if (part.length > max) {
      for (const w of part.split(/(?<=,)\s+/)) {
        if ((cur + " " + w).trim().length > max && cur) { out.push(cur.trim()); cur = ""; }
        cur += " " + w;
      }
    } else cur += " " + part;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** La voce italiana migliore disponibile (le «naturali» o di Google prima di quelle di sistema). */
function italianVoice(): SpeechSynthesisVoice | null {
  const it = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("it"));
  const score = (v: SpeechSynthesisVoice) => (/natural|neural|online/i.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.lang === "it-IT" ? 1 : 0);
  return it.sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function stopSpeaking() {
  if (!speechSupported()) return;
  window.speechSynthesis.cancel();
  setCurrent(null);
}

export function speak(key: string, text: string) {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const parts = chunks(speechText(text));
  if (!parts.length) { setCurrent(null); return; }
  const voice = italianVoice();
  setCurrent(key);
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = voice?.lang ?? "it-IT";
    if (voice) u.voice = voice;
    if (i === parts.length - 1) u.onend = () => { if (current === key) setCurrent(null); };
    u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled" && current === key) setCurrent(null); };
    synth.speak(u);
  });
}

/** Chiave del testo in lettura (null = silenzio). */
export function useSpeaking() {
  const [k, setK] = useState<string | null>(current);
  useEffect(() => {
    listeners.add(setK);
    // Le voci arrivano in ritardo su alcuni browser: basta chiederle una volta per farle caricare.
    if (speechSupported()) window.speechSynthesis.getVoices();
    return () => { listeners.delete(setK); };
  }, []);
  return k;
}
