"use client";

import { useState } from "react";
import { Icon } from "@/components/ui";
import { saveVoicePrefs } from "@/lib/actions";
import { speak, stopSpeaking, useSpeaking, useSpeechError } from "@/lib/speech";
import type { VoiceEngine } from "@/lib/settings";

const SAMPLE = "Ciao! Sono la voce del tuo Second Brain. Così ti leggerò le risposte dell'Assistente.";

/** Voce delle risposte: quella del dispositivo (gratis) o una voce IA (a consumo), con la prova. */
export function VoiceSettings({ initial, voices, aiEnabled }: { initial: { engine: VoiceEngine; aiVoice: string }; voices: [string, string][]; aiEnabled: boolean }) {
  const [engine, setEngine] = useState(initial.engine);
  const [aiVoice, setAiVoice] = useState(initial.aiVoice);
  const playing = useSpeaking();
  const error = useSpeechError();
  const save = (p: { engine: VoiceEngine; aiVoice: string }) => { setEngine(p.engine); setAiVoice(p.aiVoice); saveVoicePrefs(p); };
  const test = () => {
    if (playing === "prova") { stopSpeaking(); return; }
    speak("prova", SAMPLE, engine === "ai" ? { kind: "ai", voice: aiVoice } : { kind: "device" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="seg-sb" style={{ alignSelf: "flex-start" }}>
        <button aria-pressed={engine === "device"} onClick={() => save({ engine: "device", aiVoice })} style={{ height: 32, padding: "0 14px" }}>Voce del dispositivo</button>
        <button aria-pressed={engine === "ai"} onClick={() => save({ engine: "ai", aiVoice })} disabled={!aiEnabled} style={{ height: 32, padding: "0 14px" }}>Voce IA</button>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        {engine === "ai"
          ? "Voce naturale generata dall'IA (OpenRouter, modello audio di OpenAI): circa mezzo centesimo per ogni minuto letto, dentro il tetto di spesa. Il testo delle risposte lascia il server per essere letto. Se non è disponibile, si usa la voce del dispositivo."
          : "Gratis: legge il telefono o il computer, e il testo non esce dal dispositivo. La qualità dipende dalle voci installate (su Android: Impostazioni → Sintesi vocale)."}
        {!aiEnabled && " Per la voce IA serve la chiave OpenRouter."}
      </div>
      {engine === "ai" && (
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
          Voce
          <select className="input" value={aiVoice} onChange={(e) => save({ engine, aiVoice: e.target.value })} style={{ maxWidth: 320 }}>
            {voices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-secondary" onClick={test} style={{ gap: 6 }}>
          <Icon name={playing === "prova" ? "stop" : "volume"} size={14} />{playing === "prova" ? "Ferma" : "Prova la voce"}
        </button>
        {error && engine === "ai" && <span style={{ fontSize: 13, color: "var(--danger)" }}>Voce IA non disponibile: {error}</span>}
      </div>
      <div className="faint" style={{ fontSize: 12.5 }}>La lettura si accende e si spegne con l&apos;altoparlante accanto al microfono nell&apos;Assistente.</div>
    </div>
  );
}
