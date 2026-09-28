import { ApiError, runTool, TOOL_BY_NAME, TOOLS } from "@/lib/api-core";
import { authApi } from "@/lib/api-keys";
import { getProfile } from "@/lib/settings";

export const maxDuration = 180;

/**
 * Server MCP (Model Context Protocol, trasporto "Streamable HTTP" senza sessioni): Claude vede gli strumenti
 * di Second Brain come propri. Autenticazione con la chiave API (header Authorization: Bearer, o ?key= nell'URL).
 */
const PROTOCOL = "2025-06-18";
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg: Rpc, scope: "read" | "write") {
  switch (msg.method) {
    case "initialize": {
      const profile = await getProfile();
      return ok(msg.id, {
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "second-brain", title: "Second Brain", version: "1.0.0" },
        instructions:
          `Second Brain è la memoria personale${profile.name ? ` di ${profile.name}` : " dell'utente"}: note, documenti, decisioni, riunioni, progetti con obiettivi, persone e attività con promemoria. ` +
          "Per domande sulla sua vita, lavoro, progetti o impegni cerca prima qui (today, search_memory, ask_memory) invece di rispondere a memoria. " +
          "Le catture vanno in Inbox e l'utente le conferma nell'app. Per i comandi che modificano dati mostra prima le azioni proposte (run_command con execute=false)." +
          (scope === "read" ? " Questa chiave è in sola lettura: gli strumenti di scrittura non sono disponibili." : ""),
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: TOOLS.filter((t) => scope === "write" || t.scope === "read").map((t) => ({
          name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.scope === "read", openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = TOOL_BY_NAME.get(name);
      if (!tool) return fail(msg.id, -32602, `Strumento sconosciuto: ${name}`);
      if (tool.scope === "write" && scope !== "write") return ok(msg.id, { content: [{ type: "text", text: "Questa chiave è in sola lettura." }], isError: true });
      try {
        const out = await runTool(name, (msg.params?.arguments ?? {}) as Record<string, unknown>);
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 1) }], structuredContent: out });
      } catch (e) {
        const text = e instanceof ApiError ? e.message : e instanceof Error ? `Errore: ${e.message}` : "Errore interno.";
        return ok(msg.id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return fail(msg.id, -32601, `Metodo non supportato: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  const auth = await authApi(req, "read");
  if (!auth.ok) return Response.json(fail(null, -32001, auth.error), { status: auth.status, headers: { "WWW-Authenticate": 'Bearer realm="second-brain"' } });
  let body: Rpc | Rpc[];
  try { body = await req.json(); } catch { return Response.json(fail(null, -32700, "JSON non valido."), { status: 400 }); }
  const batch = Array.isArray(body) ? body : [body];
  const out = [];
  for (const m of batch) {
    // Le notifiche (senza id) non hanno risposta.
    if (m.id === undefined || m.id === null) { if (!String(m.method).startsWith("notifications/")) await handle(m, auth.scope); continue; }
    out.push(await handle(m, auth.scope));
  }
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? out : out[0]);
}

/** Nessun flusso server → client: il trasporto è solo richiesta/risposta. */
export function GET() {
  return new Response("Usa POST con JSON-RPC (Model Context Protocol).", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new Response(null, { status: 405 });
}
