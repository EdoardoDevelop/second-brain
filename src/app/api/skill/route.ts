import { isAuthenticated } from "@/lib/auth";
import { publicOrigin } from "@/lib/origin";
import { getProfile } from "@/lib/settings";
import { skillMarkdown, zip } from "@/lib/skill";

/** Skill per Claude da scaricare (cartella second-brain/ con SKILL.md). La chiave, se c'è, arriva nel corpo del form. */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) return new Response("Non autorizzato", { status: 401 });
  const form = await req.formData().catch(() => null);
  const key = String(form?.get("key") ?? "").trim() || null;
  const base = String(form?.get("base") ?? "").trim() || publicOrigin(req.headers);
  const md = skillMarkdown(base.replace(/\/$/, ""), key && /^sb_[\w-]+$/.test(key) ? key : null, (await getProfile()).name);
  const body = zip([{ name: "second-brain/SKILL.md", data: Buffer.from(md, "utf8") }]);
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="second-brain-skill.zip"', "Cache-Control": "no-store" },
  });
}
