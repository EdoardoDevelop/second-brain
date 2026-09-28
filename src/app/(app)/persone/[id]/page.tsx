import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon, itemIcon } from "@/components/ui";
import type { IconName } from "@/lib/icons";
import { initials, longDate, shortDate } from "@/lib/format";
import { getPersonDetail } from "@/lib/queries";
import { PersonHeader } from "./PersonHeader";
import { BriefCard } from "@/components/BriefCard";
import type { SavedBrief } from "@/lib/actions";
import { aiEnabled } from "@/lib/ai";
import { getSetting } from "@/lib/settings";


export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const [d, saved, aiOn] = await Promise.all([getPersonDetail(id), getSetting(`brief:person:${id}`), aiEnabled()]);
  if (!d) notFound();
  const { person: p, items, projects } = d;
  const meetings = items.filter((i) => i.type === "Riunione");
  const others = items.filter((i) => i.type !== "Riunione");

  const groups: { title: string; rows: { key: string; icon: IconName; label: string; meta: string; href: string }[] }[] = [
    { title: "Progetti", rows: projects.map((x) => ({ key: x.id, icon: "folder", label: x.name, meta: `${x.status} · ${x.pct}%`, href: `/progetti/${x.id}` })) },
    { title: "Riunioni", rows: meetings.map((x) => ({ key: x.id, icon: "users", label: x.title, meta: shortDate(x.createdAt), href: `/conoscenza/${x.id}` })) },
    { title: "Documenti e note", rows: others.map((x) => ({ key: x.id, icon: itemIcon(x.type, x.kind), label: x.title, meta: `${x.type ?? "Nota"} · ${shortDate(x.createdAt)}`, href: `/conoscenza/${x.id}` })) },
  ].filter((g) => g.rows.length) as typeof groups;

  const subtitle = [p.role, p.org, p.email].filter(Boolean).join(" · ");

  return (
    <div style={{ padding: "40px 48px 72px", display: "flex", flexDirection: "column", gap: 32, maxWidth: 980, minWidth: 0 }} className="person-detail">
      <Link href="/persone" className="mobile-block muted" style={{ alignItems: "center", gap: 6, fontSize: 14, textDecoration: "none", marginBottom: -16 }}><Icon name="chevronL" size={14} />Persone</Link>
      <PersonHeader id={p.id} initial={{ name: p.name, role: p.role, org: p.org, email: p.email, note: p.note }}>
        <span style={{ width: 72, height: 72, borderRadius: "50%", border: "1px solid var(--color-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-heading)", fontSize: 24, color: "var(--accent-text)", flex: "none" }}>{initials(p.name)}</span>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 220 }}>
          <h1 className="page-title" style={{ margin: 0, fontSize: 42, overflowWrap: "anywhere" }}>{p.name}</h1>
          {subtitle && (
            <div className="muted" style={{ fontSize: 15 }}>
              {[p.role, p.org].filter(Boolean).join(" · ")}
              {p.email && <>{(p.role || p.org) && " · "}<a href={`mailto:${p.email}`} style={{ color: "inherit" }}>{p.email}</a></>}
            </div>
          )}
        </div>
      </PersonHeader>

      <BriefCard kind="person" id={p.id} initial={saved ? (JSON.parse(saved) as SavedBrief) : null} count={items.length + (p.note ? 1 : 0)} aiOn={aiOn} />

      <section className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px", gap: 32, padding: "20px 0", borderTop: "1px solid var(--color-divider)", borderBottom: "1px solid var(--color-divider)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="eyebrow">Note personali</div>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, textWrap: "pretty", whiteSpace: "pre-wrap" }}>{p.note || <span className="muted">Nessuna nota. Usa Modifica per aggiungerne.</span>}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="eyebrow">Ultimo contatto</div>
          <span style={{ fontSize: 15 }}>{items[0] ? longDate(items[0].createdAt) : "—"}</span>
          <span className="muted" style={{ fontSize: 13 }}>{items.length} {items.length === 1 ? "elemento" : "elementi"} in memoria</span>
        </div>
      </section>

      {groups.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 28 }}>
          {groups.map((g) => (
            <div key={g.title} style={{ display: "flex", flexDirection: "column" }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 18 }}>{g.title}</h4>
              {g.rows.map((r) => (
                <Link key={r.key} href={r.href} className="list-btn" style={{ gridTemplateColumns: "16px minmax(0,1fr)", gap: 10, padding: "9px 0" }}>
                  <span className="muted" style={{ paddingTop: 2 }}><Icon name={r.icon} /></span>
                  <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.35, minWidth: 0 }}>
                    <span style={{ fontSize: 14 }}>{r.label}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{r.meta}</span>
                  </span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Nessun elemento in memoria menziona ancora questa persona.</p>
      )}

      {items.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h4 style={{ margin: 0, fontSize: 18 }}>Interazioni</h4>
          <div style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid var(--color-divider)", marginLeft: 4 }}>
            {items.slice(0, 10).map((h) => (
              <div key={h.id} style={{ display: "flex", gap: 14, padding: "4px 0 10px 18px", position: "relative", fontSize: 14 }}>
                <span style={{ position: "absolute", left: -4, top: 10, width: 7, height: 7, background: "var(--color-bg)", border: "1px solid var(--color-accent)" }} />
                <span className="muted" style={{ width: 60, flex: "none" }}>{shortDate(h.createdAt)}</span>
                <span>{h.type ?? "Nota"}: {h.title}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
