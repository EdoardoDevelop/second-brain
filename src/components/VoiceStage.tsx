"use client";

import { useState } from "react";
import { fmtSeconds, MAX_SECONDS } from "./useRecorder";
import { VoiceOrb } from "./VoiceOrb";

const VOICE_HINTS = [
  "«Ricordami di chiamare Marco venerdì alle 15»",
  "«Metti il progetto Alpha al 60%»",
  "«Annota che il fornitore consegna a fine mese»",
  "«Abbiamo raggiunto l'obiettivo del preventivo»",
];

/**
 * Contenuto del pannello della voce: sfera animata, stato, cronometro e pulsanti.
 * Usato dalla barra dei comandi e, dentro `VoiceSheet`, dall'Assistente.
 */
export function VoiceStage({ analyser, listening, seconds, thinkingTitle = "Ho capito, ci penso…", thinkingText = "Trascrivo e preparo le azioni", hints = VOICE_HINTS, onCancel, onStop }: {
  analyser: AnalyserNode | null; listening: boolean; seconds: number;
  thinkingTitle?: string; thinkingText?: string; hints?: string[];
  onCancel: () => void; onStop: () => void;
}) {
  const [hint] = useState(() => hints[Math.floor(Math.random() * hints.length)]!);
  return (
    <div className="voice-stage">
      <VoiceOrb analyser={analyser} mode={listening ? "listening" : "thinking"} size={220} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: "var(--font-heading-weight)" as never, fontSize: 24 }}>
          {listening ? "Ti ascolto…" : thinkingTitle}
        </div>
        <div className="muted" style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
          {listening ? <>{fmtSeconds(seconds)} <span className="faint">/ {fmtSeconds(MAX_SECONDS)}</span></> : thinkingText}
        </div>
        {listening && <div className="muted" style={{ fontSize: 13, maxWidth: 360, paddingTop: 6 }}>Per esempio: {hint}</div>}
      </div>
      {listening && (
        <div className="voice-actions">
          <button className="btn btn-ghost" onClick={onCancel} style={{ color: "var(--muted)" }}>Annulla</button>
          <button className="btn btn-primary voice-stop" onClick={onStop}><span style={{ width: 12, height: 12, background: "currentColor", borderRadius: 2 }} />Fine</button>
        </div>
      )}
    </div>
  );
}

/** Pannello della voce a sé (sopra la pagina): al centro su computer, dal basso su telefono. */
export function VoiceSheet(props: Parameters<typeof VoiceStage>[0]) {
  return (
    <div className="cmd-overlay" onClick={() => props.listening && props.onCancel()}>
      <div className="blueprint cmd-sheet" role="dialog" aria-label="Registrazione" onClick={(e) => e.stopPropagation()}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <VoiceStage {...props} />
      </div>
    </div>
  );
}
