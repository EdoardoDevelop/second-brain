import { ApiError, runTool, TOOL_BY_NAME } from "@/lib/api-core";
import { authApi } from "@/lib/api-keys";
import { publicOrigin } from "@/lib/origin";

export const maxDuration = 180;

type Route = { method: string; path: RegExp; tool: string; doc: string };

/** Endpoint REST: ognuno corrisponde a uno strumento (gli stessi del server MCP). */
const ROUTES: Route[] = [
  { method: "GET", path: /^today$/, tool: "today", doc: "GET /today — la giornata: scadute, di oggi, prossime, Inbox da confermare" },
  { method: "GET", path: /^search$/, tool: "search_memory", doc: "GET /search?query=…&limit=10 — ricerca nella memoria" },
  { method: "GET", path: /^items$/, tool: "recent_items", doc: "GET /items?limit=10&type=Decisione — elementi recenti" },
  { method: "GET", path: /^items\/(?<id>[\w-]+)$/, tool: "get_item", doc: "GET /items/{id} — contenuto completo" },
  { method: "POST", path: /^capture$/, tool: "capture", doc: "POST /capture {text, title?} — cattura in Inbox" },
  { method: "POST", path: /^ask$/, tool: "ask_memory", doc: "POST /ask {question, scope?} — risposta con fonti" },
  { method: "GET", path: /^tasks$/, tool: "list_tasks", doc: "GET /tasks?status=open|done|all&projectId=… — attività" },
  { method: "POST", path: /^tasks$/, tool: "add_task", doc: "POST /tasks {title, due?, time?, reminder?, projectId?, priority?}" },
  { method: "PATCH", path: /^tasks\/(?<id>[\w-]+)$/, tool: "update_task", doc: "PATCH /tasks/{id} {done?, title?, due?, time?, reminder?, priority?, projectId?}" },
  { method: "GET", path: /^projects$/, tool: "list_projects", doc: "GET /projects?status=Attivo — progetti" },
  { method: "GET", path: /^projects\/(?<id>[\w-]+)$/, tool: "get_project", doc: "GET /projects/{id} — obiettivi, attività, documenti, sintesi" },
  { method: "GET", path: /^people$/, tool: "list_people", doc: "GET /people?query=… — persone" },
  { method: "GET", path: /^people\/(?<id>[\w-]+)$/, tool: "get_person", doc: "GET /people/{id} — dettaglio persona" },
  { method: "GET", path: /^relations$/, tool: "trace_relations", doc: "GET /relations?id=…|name=… — percorso delle relazioni di un progetto, una persona o un obiettivo" },
  { method: "POST", path: /^command$/, tool: "run_command", doc: "POST /command {text, execute?} — comando in linguaggio naturale" },
];

async function handle(req: Request, params: Promise<{ path?: string[] }>) {
  const path = ((await params).path ?? []).join("/");
  if (!path) {
    return Response.json({
      name: "Second Brain API", version: 1,
      auth: "Header Authorization: Bearer <chiave> (dalle Impostazioni). Le chiavi in sola lettura non possono usare POST/PATCH.",
      mcp: `${publicOrigin(req.headers)}/api/mcp`,
      endpoints: ROUTES.map((r) => r.doc),
    });
  }
  const route = ROUTES.find((r) => r.method === req.method && r.path.test(path));
  if (!route) return Response.json({ error: `Endpoint sconosciuto: ${req.method} /${path}` }, { status: 404 });
  const tool = TOOL_BY_NAME.get(route.tool)!;
  const auth = await authApi(req, tool.scope);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const args: Record<string, unknown> = Object.fromEntries(new URL(req.url).searchParams);
  delete args.key;
  if (args.q && !args.query) args.query = args.q;
  if (req.method !== "GET") {
    const body = await req.json().catch(() => null);
    if (body && typeof body === "object") Object.assign(args, body);
  }
  Object.assign(args, route.path.exec(path)?.groups ?? {});
  try {
    return Response.json(await runTool(route.tool, args));
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[api]", e);
    return Response.json({ error: e instanceof Error ? e.message : "Errore interno." }, { status: 500 });
  }
}

type Ctx = { params: Promise<{ path?: string[] }> };
export const GET = (req: Request, ctx: Ctx) => handle(req, ctx.params);
export const POST = (req: Request, ctx: Ctx) => handle(req, ctx.params);
export const PATCH = (req: Request, ctx: Ctx) => handle(req, ctx.params);
