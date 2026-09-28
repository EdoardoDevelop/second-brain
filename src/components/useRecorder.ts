"use client";

import { useEffect, useRef, useState } from "react";

export const MAX_SECONDS = 120;

/**
 * Registrazione dal microfono. onAudio riceve un WAV mono 16 kHz in base64.
 * Al termine (stop o limite di tempo) l'audio viene consegnato; release() spegne senza consegnare.
 */
export function useRecorder(onAudio: (wav: string) => void, onError: (msg: string) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  /** Analizzatore del segnale del microfono, per le animazioni che seguono la voce. */
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; timer: number; audio: AudioContext | null } | null>(null);

  const closeAudio = (a: AudioContext | null) => {
    setAnalyser(null);
    a?.close().catch(() => {});
  };
  const cb = useRef({ onAudio, onError });
  cb.current = { onAudio, onError };

  const stop = () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    window.clearInterval(r.timer);
    closeAudio(r.audio);
    setRecording(false);
    if (r.recorder.state !== "inactive") r.recorder.stop();
  };

  const release = () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    window.clearInterval(r.timer);
    closeAudio(r.audio);
    r.recorder.onstop = null;
    if (r.recorder.state !== "inactive") r.recorder.stop();
    r.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
  };

  const start = async () => {
    if (rec.current) return;
    let stream: MediaStream;
    try {
      // Voce pulita: niente eco, rumore di fondo ridotto e volume regolato, un solo canale.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch {
      cb.current.onError("Microfono non disponibile: controlla i permessi del browser.");
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try {
        cb.current.onAudio(await toWavBase64(new Blob(chunks, { type: recorder.mimeType })));
      } catch {
        cb.current.onError("Impossibile leggere la registrazione.");
      }
    };
    recorder.start();
    // Solo per l'animazione: se l'AudioContext non è disponibile la registrazione funziona comunque.
    let audio: AudioContext | null = null;
    try {
      audio = new AudioContext();
      const node = audio.createAnalyser();
      node.fftSize = 256;
      node.smoothingTimeConstant = 0.75;
      audio.createMediaStreamSource(stream).connect(node);
      setAnalyser(node);
    } catch {
      audio = null;
    }
    setSeconds(0);
    const began = Date.now();
    const timer = window.setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
    rec.current = { recorder, stream, timer, audio };
    setRecording(true);
  };

  useEffect(() => release, []);

  return { recording, seconds, analyser, start, stop, release };
}

export const fmtSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Converte la registrazione (webm/mp4, a seconda del browser) in WAV mono 16 kHz, in base64. */
async function toWavBase64(blob: Blob): Promise<string> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);

  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i]!)) * 0x7fff, true);

  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
