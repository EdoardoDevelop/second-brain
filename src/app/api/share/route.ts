import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { ready } from "@/lib/db";
import { captureText, captureUpload } from "@/lib/capture";
import { log } from "@/lib/pipeline";

/**
 * Destinazione del «Condividi» del telefono (share_target nel manifest).
 * Salva subito in Inbox e torna alla pagina: lettura e classificazione proseguono in background.
 * Accetta qualsiasi campo: le app non compilano sempre title/text/url come previsto.
 */
export async function POST(req: Request) {
  const go = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
  if (!(await isAuthenticated())) return go("/login");
  await ready();

  let form: FormData | null = null;
  let parseError = "";
  // Il corpo si legge una volta sola: prima i byte (per il log), poi il parsing.
  const raw = Buffer.from(await req.arrayBuffer());
  try {
    form = await new Request(req.url, { method: "POST", headers: { "content-type": req.headers.get("content-type") ?? "" }, body: raw }).formData();
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }
  const received = form ? [...form.entries()].map(([k, v]) => (typeof v === "string" ? `${k}(testo ${v.length})` : `${k}(file ${v.type || "?"} ${v.size} B)`)).join(", ") : "";
  console.log(`[share] ${raw.length} B · ${req.headers.get("user-agent")} · ${received || "nessun campo"}${parseError ? " · errore: " + parseError : ""}${raw.length < 400 ? " · " + JSON.stringify(raw.toString("latin1")) : ""}`);
  if (!form) {
    await log("Condivisione", null, "Errore: richiesta non leggibile · " + parseError);
    return go("/inbox?condiviso=errore&msg=" + encodeURIComponent("richiesta non leggibile"));
  }

  const strings = (k: string) => form.getAll(k).filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
  const title = strings("title")[0] ?? "";
  // Testo da tutti i campi di testo, non solo "text".
  const texts = [...form.entries()].filter(([k, v]) => k !== "title" && typeof v === "string" && v.trim()).map(([, v]) => (v as string).trim());
  const text = [...new Set(texts)].join("\n");
  const url = strings("url")[0] || text.match(/https?:\/\/\S+/)?.[0] || "";
  const note = [title, text].filter((x) => x && x !== url).join("\n");
  const files = [...form.values()].filter((f): f is File => typeof f !== "string" && f.size > 0);

  let saved = 0;
  let error = "";
  for (const f of files) {
    const res = await captureUpload(f, note, { source: "Condiviso", wait: false });
    if ("error" in res) error = res.error; else saved++;
  }
  if (!files.length && (url || note)) {
    const content = url ? [url, note.replace(url, "").trim()].filter(Boolean).join("\n\n") : note;
    await captureText(content, { kind: url ? "link" : "note", source: "Condiviso", title: title || undefined, wait: false });
    saved++;
  }
  if (!saved) await log("Condivisione", null, `Errore: niente da salvare · ${error || received || "nessun campo"}`);
  revalidatePath("/", "layout");
  return go(saved ? `/inbox?condiviso=${saved}` : `/inbox?condiviso=errore&msg=${encodeURIComponent(error || "nessun contenuto ricevuto")}`);
}
