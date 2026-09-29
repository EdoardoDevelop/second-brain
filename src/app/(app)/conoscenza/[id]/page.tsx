import Link from "next/link";
import { notFound } from "next/navigation";
import { Blueprint, Icon, itemIcon } from "@/components/ui";
import { AiActions, ContentEditor, ItemButtons, MetaEditor } from "./DetailClient";
import { dueInfo, longDate, shortDate } from "@/lib/format";
import { getAttachments, getItemAims, getItemDetail, getPeople, getProjects } from "@/lib/queries";
import { AimLinks } from "@/components/AimLinks";
import type { Attachment } from "@/lib/db/schema";
import { aiEnabled } from "@/lib/ai";
import { PdfCard } from "@/components/PdfCard";

export default async function DetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const [d, allProjects, allPeople, files, itemAims] = await Promise.all([getItemDetail(id), getProjects(), getPeople(), getAttachments(id), getItemAims(id)]);
  if (!d || d.item.status === "archived") notFound();
  const { item, project, persons, linked, tasks, log } = d;
  const conflicts = linked.filter((l) => l.kind === "conflict");

  const groups = [
    { title: "Persone", items: persons.map((p) => ({ key: p.id, icon: "user" as const, label: p.name, meta: p.role, href: `/persone/${p.id}` })) },
    { title: "Progetto", items: project ? [{ key: project.id, icon: "folder" as const, label: project.name, meta: `${project.status} · ${project.pct}%`, href: `/progetti/${project.id}` }] : [] },
    { title: "Documenti e note", items: linked.map((l) => ({ key: l.id, icon: itemIcon(l.type, "note"), label: l.title, meta: `${l.type ?? "Nota"} · ${shortDate(l.createdAt)}`, href: `/conoscenza/${l.id}` })) },
    { title: "Attività", items: tasks.map((t) => ({ key: t.id, icon: "tasks" as const, label: t.title, meta: dueInfo(t.due).label || (t.done ? "Completata" : "Senza scadenza"), href: "/attivita" })) },
  ].filter((g) => g.items.length);

  const prov: [string, string][] = [
    ["Origine", item.origin],
    ["Fonte", item.source],
    ["Creato", longDate(item.createdAt)],
    ["Ultima modifica", longDate(item.updatedAt)],
    ["Confermato", item.confirmedAt ? longDate(item.confirmedAt) : "—"],
    ["Visibilità", "Solo tu"],
  ];

  return (
    <div className="page stack-mobile" style={{ maxWidth: 1320, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 48 }}>
      <article style={{ display: "flex", flexDirection: "column", gap: 32, minWidth: 0 }}>
        <MetaEditor
          id={item.id}
          meta={{ title: item.title, type: item.type ?? "Nota", summary: item.summary ?? "", tags: item.tags, projectId: item.projectId, personIds: persons.map((p) => p.id) }}
          projects={allProjects.map((p) => ({ id: p.id, name: p.name }))}
          people={allPeople.map((p) => ({ id: p.id, name: p.name }))}
        >
        <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-text)" }}>
            <Icon name={itemIcon(item.type, item.kind)} />{item.type ?? "Nota"}
          </div>
          <h1 className="page-title" style={{ margin: 0, fontSize: 46, letterSpacing: "-.02em", overflowWrap: "anywhere" }}>{item.title}</h1>
          <div className="muted" style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
            <span>{shortDate(item.createdAt)}</span><span>{item.origin}</span><span>{linked.length} {linked.length === 1 ? "collegamento" : "collegamenti"}</span>
          </div>
          {item.tags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {item.tags.map((t) => <span key={t} style={{ fontSize: 12, padding: "2px 8px", background: "var(--sel)", color: "var(--accent-text)" }}>#{t}</span>)}
            </div>
          )}
        </header>
        </MetaEditor>

        {conflicts.map((c) => (
          <div key={c.id} className="alert">
            <Icon name="alert" style={{ color: "var(--danger)" }} />
            <span style={{ flex: 1 }}>In conflitto con <b style={{ fontWeight: 500 }}>{c.title}</b> ({shortDate(c.createdAt)}).{c.reason ? " " + c.reason : ""}</span>
            <Link href={`/conoscenza/${c.id}`} className="btn btn-secondary">Apri</Link>
          </div>
        ))}

        {item.summary && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="eyebrow">Overview</div>
            <p style={{ margin: 0, fontSize: 19, lineHeight: 1.55, textWrap: "pretty" }}>{item.summary}</p>
            <div className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="ai" />Sintesi generata dall&apos;IA{item.confirmedAt ? ` · confermata da te il ${shortDate(item.confirmedAt)}` : ""}
            </div>
          </section>
        )}

        {files.map((f) => <AttachmentView key={f.id} file={f} />)}

        <ContentEditor id={item.id} content={item.content} isLink={item.kind === "link"} />

        <Blueprint as="section" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="eyebrow">Azioni IA</div>
          <AiActions id={item.id} enabled={await aiEnabled()} />
        </Blueprint>

        {groups.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="eyebrow">Collegati</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 24 }}>
              {groups.map((g) => (
                <div key={g.title} style={{ display: "flex", flexDirection: "column" }}>
                  <div className="muted" style={{ fontSize: 13, paddingBottom: 6 }}>{g.title}</div>
                  {g.items.map((i) => {
                    const inner = (
                      <>
                        <span className="muted" style={{ paddingTop: 2 }}><Icon name={i.icon} /></span>
                        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.35, minWidth: 0 }}>
                          <span style={{ fontSize: 14 }}>{i.label}</span>
                          <span className="muted" style={{ fontSize: 12 }}>{i.meta}</span>
                        </span>
                      </>
                    );
                    const style = { gridTemplateColumns: "16px minmax(0,1fr)", gap: 10, padding: "9px 0" };
                    return i.href
                      ? <Link key={i.key} href={i.href} className="list-btn" style={style}>{inner}</Link>
                      : <div key={i.key} className="list-btn" style={{ ...style, cursor: "default" }}>{inner}</div>;
                  })}
                </div>
              ))}
            </div>
          </section>
        )}
      </article>

      <aside style={{ display: "flex", flexDirection: "column", gap: 28, paddingTop: 6 }}>
        <AimLinks itemId={item.id} linked={itemAims.linked} open={itemAims.open} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon name="shield" />Provenienza</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {prov.map(([k, v]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr)", gap: 10, padding: "8px 0", borderTop: "1px solid var(--color-divider)", fontSize: 13 }}>
                <span className="muted">{k}</span><span>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon name="ai" />Cosa ha fatto l&apos;IA</div>
          {log.length ? log.map((a) => (
            <div key={a.id} className="muted" style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13 }}>
              <Icon name={a.outcome.startsWith("Errore") ? "alert" : a.outcome === "Proposta" || a.outcome.startsWith("In attesa") ? "timeline" : "check"} size={14} style={{ marginTop: 3 }} />
              <span>{a.action} · {a.outcome}<br /><span className="faint" style={{ fontSize: 12 }}>{longDate(a.at)}</span></span>
            </div>
          )) : <div className="muted" style={{ fontSize: 13 }}>Nessuna azione registrata.</div>}
        </div>
        <ItemButtons id={item.id} title={item.title} markdown={toMarkdown(item.title, item.type, item.tags, item.summary, item.content)} />
      </aside>
    </div>
  );
}

function toMarkdown(title: string, type: string | null, tags: string[], summary: string | null, content: string) {
  return [`# ${title}`, "", `Tipo: ${type ?? "Nota"}`, tags.length ? `Tag: ${tags.map((t) => "#" + t).join(" ")}` : "", "", summary ? `> ${summary}\n` : "", content, ""].join("\n");
}

function AttachmentView({ file: f }: { file: Attachment }) {
  const url = `/api/files/${f.id}`;
  const pdf = f.mime === "application/pdf";
  const size = f.size >= 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="eyebrow">Allegato</div>
      {f.mime.startsWith("image/") && (
        // Il clic apre il popup delle immagini (Lightbox, montato nel layout radice).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={f.name} title="Clic per ingrandire" style={{ display: "block", alignSelf: "flex-start", maxWidth: "100%", maxHeight: 520, border: "1px solid var(--color-divider)", cursor: "zoom-in" }} />
      )}
      {f.mime.startsWith("audio/") && <audio controls preload="metadata" src={url} style={{ width: "100%", maxWidth: 520 }} />}
      {pdf && <PdfCard url={url} name={f.name} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {/* I PDF si aprono nel lettore integrato (PdfViewer, data-pdf), il resto in una nuova scheda. */}
        <a className="source-chip" href={url} {...(pdf ? { "data-pdf": f.name } : { target: "_blank", rel: "noreferrer" })}><Icon name="file" size={14} /><span className="ellipsis">{f.name}</span></a>
        <span className="muted" style={{ fontSize: 12 }}>{size}</span>
        <a className="btn btn-ghost" href={`${url}?download=1`} style={{ height: 30, gap: 6, color: "var(--muted)" }}><Icon name="download" size={14} />Scarica</a>
      </div>
    </section>
  );
}
