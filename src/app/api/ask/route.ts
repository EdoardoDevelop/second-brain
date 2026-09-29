import { inArray } from "drizzle-orm";
import { isAuthenticated } from "@/lib/auth";
import { aiEnabled, contextNames, quickCommand, type ChatTurn } from "@/lib/ai";
import { runAgent } from "@/lib/agent";
import type { AskEvent, ChatAnswer } from "@/lib/chat";
import { db } from "@/lib/db";
import { items } from "@/lib/db/schema";
import { isoDay } from "@/lib/format";
import { log } from "@/lib/pipeline";
import { commandContext } from "@/lib/queries";
import { extractDiary, getCheckin, markAnswered } from "@/lib/checkin";

export const maxDuration = 300;

const SCOPE_LABEL = (s: string) => (s === "all" ? "tutta la memoria" : s === "recent" ? "ultimi 30 giorni" : s.startsWith("project:") ? "progetto" : s.startsWith("person:") ? "persona" : s.startsWith("diary:") ? "diario" : s);

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

        // «Com'è andata oggi?»: conversazione da amico, poi una sola scheda con tutto quello che si è capito.
        const checkin = scope.startsWith("diary:") ? await getCheckin(scope.slice(6)) : null;
        if (checkin && checkin.status !== "closed") {
          const t0 = Date.now();
          await markAnswered(checkin.id);
          const asked = turns.filter((t) => t.role === "assistant").length; // la prima è l'apertura
          const r = await runAgent({
            question: q, turns, scope: "all", mode: "checkin", tier: "smart", signal: req.signal,
            checkin: { reason: checkin.events.filter((e) => e.score >= 5).map((e) => e.text), goal: checkin.goal ?? "", asked: Math.max(0, asked - 1) },
            onEvent: (e) => send(e),
          });
          const userTurns = turns.filter((t) => t.role === "user").length + 1;
          const closing = r.done || userTurns >= 4;
          send({ type: "answer", answer: { text: r.text, note: "", sources: [], read: 0, model: r.model, cost: r.cost } });
          if (closing) {
            const conversation = [...turns, { role: "user" as const, text: q }, { role: "assistant" as const, text: r.text }];
            const ex = await extractDiary(checkin.id, conversation);
            if (ex.actions.length) send({ type: "command", actions: ex.actions, names: ex.names });
            if (ex.facts.length) send({ type: "facts", facts: ex.facts });
          }
          await log("Com'è andata oggi?", null, `${closing ? "chiusa" : "risposta"} · ${((Date.now() - t0) / 1000).toFixed(1).replace(".", ",")} s · ${r.model}`);
          send({ type: "done" });
          try { controller.close(); } catch { /* già chiuso */ }
          return;
        }

        // Via veloce: se è solo un comando, le azioni arrivano da un unico passaggio del modello rapido.
        if (!expert) {
          const t0 = Date.now();
          const ctx = await commandContext();
          const quick = await quickCommand(q, ctx, turns).catch(() => null);
          if (quick && !quick.question && (quick.actions.length || quick.facts.length)) {
            if (quick.actions.length) send({ type: "command", actions: quick.actions, names: contextNames(ctx) });
            if (quick.facts.length) send({ type: "facts", facts: quick.facts });
            await log("Messaggio all'assistente", null, `via veloce · ${quick.actions.length} azioni e ${quick.facts.length} fatti proposti · ${((Date.now() - t0) / 1000).toFixed(1).replace(".", ",")} s`);
            send({ type: "done" });
            try { controller.close(); } catch { /* già chiuso */ }
            return;
          }
        }

        const started = Date.now();
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
          [`${((Date.now() - started) / 1000).toFixed(1).replace(".", ",")} s`, `${r.steps.length} passi`, `${answer.sources.length} fonti`, r.actions.length && `${r.actions.length} azioni proposte`, r.facts.length && `${r.facts.length} fatti proposti`, r.model, `$${r.cost.toFixed(4)}`].filter(Boolean).join(" · "),
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
