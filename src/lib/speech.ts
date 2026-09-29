"use client";

import { useEffect, useState } from "react";

/**
 * Lettura ad alta voce. Due motori, scelti nelle Impostazioni:
 * - device: sintesi vocale del dispositivo (Web Speech API), gratis e senza inviare il testo a nessuno;
 * - ai: voce IA via /api/speak (OpenRouter), a pezzi: il pezzo dopo si chiede mentre suona quello prima.
 * Un solo testo alla volta; `key` dice quale (per il pulsante play/stop del messaggio giusto).
 */

export type SpeechEngine = { kind: "device" } | { kind: "ai"; voice: string };
let engine: SpeechEngine = { kind: "device" };
export const configureSpeech = (e: SpeechEngine) => { engine = e; };

let current: string | null = null;
/** Cresce a ogni nuova lettura o stop: le letture vecchie in corso se ne accorgono e si fermano. */
let epoch = 0;
let audio: HTMLAudioElement | null = null;
/** Audio IA già scaricati (voce + testo), per riascoltare senza pagare di nuovo. */
const cache = new Map<string, Promise<string>>();
const listeners = new Set<(k: string | null) => void>();
const setCurrent = (k: string | null) => { current = k; listeners.forEach((l) => l(k)); };

const deviceSpeech = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
export const speechSupported = () => typeof window !== "undefined" && (deviceSpeech() || typeof Audio !== "undefined");

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
export function chunks(s: string, max = 220): string[] {
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
  epoch++;
  if (audio) { audio.pause(); audio = null; }
  if (deviceSpeech()) window.speechSynthesis.cancel();
  setCurrent(null);
}

/** Legge `text`; `withEngine` forza un motore (la prova nelle Impostazioni). */
export function speak(key: string, text: string, withEngine?: SpeechEngine) {
  stopSpeaking();
  const e = withEngine ?? engine;
  if (e.kind === "ai") { void speakAi(key, text, e.voice, ++epoch); return; }
  speakDevice(key, chunks(speechText(text)));
}

function fetchAudio(voice: string, text: string): Promise<string> {
  const k = voice + "|" + text;
  let p = cache.get(k);
  if (!p) {
    p = fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice }) })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `Errore ${r.status}`);
        return URL.createObjectURL(await r.blob());
      });
    p.catch(() => cache.delete(k));
    cache.set(k, p);
    // Tetto alla cache: gli audio più vecchi si liberano.
    if (cache.size > 60) { const [old] = cache.keys(); cache.get(old)!.then(URL.revokeObjectURL, () => {}); cache.delete(old); }
  }
  return p;
}

async function speakAi(key: string, text: string, voice: string, my: number) {
  // Il primo pezzo corto, così la voce parte presto; poi pezzi lunghi: meno richieste, voce più continua.
  const t = speechText(text);
  const first = chunks(t, 180)[0] ?? "";
  const parts = first ? [first, ...chunks(t.slice(first.length).trim(), 450)] : [];
  if (!parts.length) return;
  setCurrent(key);
  for (let i = 0; i < parts.length; i++) {
    let url: string;
    try {
      const p = fetchAudio(voice, parts[i]);
      if (i + 1 < parts.length) fetchAudio(voice, parts[i + 1]).catch(() => {});
      url = await p;
    } catch (err) {
      // Voce IA non disponibile (rete, tetto di spesa…): il resto con la voce del dispositivo.
      if (my !== epoch) return;
      const msg = err instanceof Error ? err.message : "Voce IA non disponibile.";
      errorListeners.forEach((l) => l(msg));
      if (deviceSpeech()) speakDevice(key, parts.slice(i).flatMap((x) => chunks(x)));
      else setCurrent(null);
      return;
    }
    if (my !== epoch) return;
    const ok = await new Promise<boolean>((resolve) => {
      const a = new Audio(url);
      audio = a;
      a.onended = () => resolve(true);
      a.onerror = () => resolve(false);
      a.play().catch(() => resolve(false));
    });
    if (my !== epoch) return;
    if (!ok) break;
  }
  if (my === epoch) { audio = null; setCurrent(null); }
}

const errorListeners = new Set<(e: string | null) => void>();
/** L'ultimo errore della voce IA (per avvisare che si è passati alla voce del dispositivo). */
export function useSpeechError() {
  const [e, setE] = useState<string | null>(null);
  useEffect(() => { errorListeners.add(setE); return () => { errorListeners.delete(setE); }; }, []);
  return e;
}

function speakDevice(key: string, parts: string[]) {
  if (!deviceSpeech()) return;
  const synth = window.speechSynthesis;
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
    if (deviceSpeech()) window.speechSynthesis.getVoices();
    return () => { listeners.delete(setK); };
  }, []);
  return k;
}
