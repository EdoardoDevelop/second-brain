import { inArray } from "drizzle-orm";
import { isAuthenticated } from "@/lib/auth";
import { aiEnabled, type ChatTurn } from "@/lib/ai";
import { runAgent } from "@/lib/agent";
import type { AskEvent, ChatAnswer } from "@/lib/chat";
import { db } from "@/lib/db";
import { items } from "@/lib/db/schema";
import { isoDay } from "@/lib/format";
import { log } from "@/lib/pipeline";

export const maxDuration = 300;

const SCOPE_LABEL = (s: string) => (s === "all" ? "tutta la memoria" : s === "recent" ? "ultimi 30 giorni" : s.startsWith("project:") ? "progetto" : s.startsWith("person:") ? "persona" : s);

/**
 * Messaggio all'Assistente, con risposta in streaming (una riga JSON per evento, vedi AskEvent).
 * L'Assistente lavora a passi con gli strumenti (lib/agent.ts): cerca, legge, poi risponde con le fonti.
 * Le modifiche arrivano come azioni proposte, eseguite solo dopo la conferma.
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) return Response.json({ error: "Non autorizzato" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { question?: string; turns?: ChatTurn[]; scope?: string; focus?: string; expert?: boolean };
  const q = String(body.question ?? "").trim();
  const turns = Array.isArray(body.turns) ? body.turns.slice(-8) : [];
  const scope = String(body.scope ?? "all");
  const expert = body.expert === true;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AskEvent) => { try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch { /* client chiuso */ } };
      try {
        if (!(await aiEnabled())) throw new Error("Imposta la chiave OpenRouter nelle Impostazioni per usare l'assistente.");
        if (!q) throw new Error("Scrivi una domanda.");
        send({ type: "step", step: 0 });
        send({ type: "scope", scope: SCOPE_LABEL(scope) });

        const r = await runAgent({
          question: q, turns, scope, focus: body.focus, tier: expert ? "expert" : "smart", signal: req.signal,
          onEvent: (e) => send(e),
        });

        if (r.actions.length) send({ type: "command", actions: r.actions, names: r.names });
        if (r.facts.length) send({ type: "facts", facts: r.facts });

        const rows = r.sources.length ? await db.select().from(items).where(inArray(items.id, r.sources)) : [];
        const byId = new Map(rows.map((i) => [i.id, i]));
        const answer: ChatAnswer = {
          text: r.text, note: r.note, read: r.read, followUps: r.followUps, steps: r.steps, model: r.model, cost: r.cost, expert: r.tier === "expert",
          sources: r.sources.filter((id) => byId.has(id)).map((id) => {
            const i = byId.get(id)!;
            return { id, title: i.title, type: i.type, kind: i.kind, date: isoDay(i.createdAt) };
          }),
        };
        if (answer.text || !r.actions.length) send({ type: "answer", answer });

        await log(
          expert ? "Messaggio all'assistente (Pensa meglio)" : "Messaggio all'assistente",
          null,
          [`${r.steps.length} passi`, `${answer.sources.length} fonti`, r.actions.length && `${r.actions.length} azioni proposte`, r.facts.length && `${r.facts.length} fatti proposti`, r.model, `$${r.cost.toFixed(4)}`].filter(Boolean).join(" · "),
        );
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "Errore dell'IA." });
      }
      send({ type: "done" });
      try { controller.close(); } catch { /* già chiuso */ }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // nginx non deve accumulare la risposta: gli eventi devono arrivare subito.
      "X-Accel-Buffering": "no",
    },
  });
}
