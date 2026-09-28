import { isAuthenticated } from "@/lib/auth";
import { db, ready } from "@/lib/db";
import { aiLog, attachments, chats, facts, goals, itemPeople, items, links, people, projects, tasks } from "@/lib/db/schema";
import { isoDay, shortDate } from "@/lib/format";

/** Esporta tutti i dati: ?format=json (completo, reimportabile) oppure ?format=md (leggibile). */
export async function GET(req: Request) {
  if (!(await isAuthenticated())) return new Response("Non autorizzato", { status: 401 });
  await ready();
  const format = new URL(req.url).searchParams.get("format") === "md" ? "md" : "json";
  const [its, ps, pp, ip, ls, ts, log, att, gs, ch, fa] = await Promise.all([
    db.select().from(items), db.select().from(projects), db.select().from(people), db.select().from(itemPeople),
    db.select().from(links), db.select().from(tasks), db.select().from(aiLog), db.select().from(attachments), db.select().from(goals).orderBy(goals.ord), db.select().from(chats), db.select().from(facts),
  ]);
  const name = `second-brain-${isoDay()}.${format}`;
  const headers = (type: string) => ({ "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"` });

  if (format === "json") {
    const body = { exportedAt: new Date().toISOString(), items: its, projects: ps, people: pp, itemPeople: ip, links: ls, tasks: ts, goals: gs, chats: ch, facts: fa, aiLog: log, attachments: att };
    return new Response(JSON.stringify(body, null, 2), { headers: headers("application/json; charset=utf-8") });
  }

  const projName = new Map(ps.map((p) => [p.id, p.name]));
  const personName = new Map(pp.map((p) => [p.id, p.name]));
  const out: string[] = [`# Second Brain — esportazione del ${isoDay()}`, ""];

  out.push("## Progetti", "");
  for (const p of ps) {
    out.push(`### ${p.name}`, `Stato: ${p.status} · ${p.pct}%${p.next ? ` · Prossimo: ${p.next}` : ""}`, "", p.description, "");
    const mine = gs.filter((g) => g.projectId === p.id);
    if (mine.length) out.push("Obiettivi:", ...mine.map((g) => `- [${g.done ? "x" : " "}] ${g.title}`), "");
  }

  out.push("## Persone", "");
  for (const p of pp) out.push(`- **${p.name}**${[p.role, p.org, p.email].filter(Boolean).length ? " — " + [p.role, p.org, p.email].filter(Boolean).join(", ") : ""}${p.note ? `  \n  ${p.note.replace(/\n/g, "  \n  ")}` : ""}`);
  out.push("");

  out.push("## Attività", "");
  for (const t of ts) out.push(`- [${t.done ? "x" : " "}] ${t.title}${t.due ? ` (scadenza ${t.due})` : ""}${t.projectId ? ` · ${projName.get(t.projectId) ?? ""}` : ""}`);
  out.push("");

  out.push("## Memoria", "");
  for (const it of its.filter((i) => i.status === "memory" || i.status === "archived")) {
    const who = ip.filter((x) => x.itemId === it.id).map((x) => personName.get(x.personId)).filter(Boolean);
    out.push(`### ${it.title}`);
    out.push(`*${it.type ?? "Nota"} · ${shortDate(it.createdAt)}${it.status === "archived" ? " · archiviato" : ""}${it.projectId ? ` · ${projName.get(it.projectId) ?? ""}` : ""}${who.length ? ` · ${who.join(", ")}` : ""}*`);
    if (it.tags.length) out.push(it.tags.map((t) => "#" + t).join(" "));
    out.push("");
    if (it.summary) out.push(`> ${it.summary}`, "");
    out.push(it.content, "");
  }
  return new Response(out.join("\n"), { headers: headers("text/markdown; charset=utf-8") });
}
