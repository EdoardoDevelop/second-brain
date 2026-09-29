import { isAuthenticated } from "@/lib/auth";
import { LlmError, pcmToWav, synthesize } from "@/lib/llm";
import { getVoicePrefs, AI_VOICES } from "@/lib/settings";

export const maxDuration = 120;

/**
 * Voce IA: legge un pezzo di testo e restituisce l'audio WAV. Il client divide le risposte lunghe
 * e chiede il pezzo successivo mentre suona il precedente. `voice` serve alla prova nelle Impostazioni.
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) return Response.json({ error: "Non autorizzato" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { text?: string; voice?: string };
  const text = String(body.text ?? "").trim().slice(0, 1500);
  if (!text) return Response.json({ error: "Testo vuoto." }, { status: 400 });
  const voice = AI_VOICES.some(([v]) => v === body.voice) ? body.voice! : (await getVoicePrefs()).aiVoice;
  try {
    const wav = pcmToWav(await synthesize(text, voice, req.signal));
    return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof LlmError && e.status === 402 ? 402 : 502;
    return Response.json({ error: e instanceof Error ? e.message : "Errore della voce IA." }, { status });
  }
}
