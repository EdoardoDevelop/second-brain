"use client";

import Link from "next/link";
import { useState } from "react";
import { Blueprint, Icon } from "@/components/ui";
import type { IconName } from "@/lib/icons";
import { isoDay, shortDate } from "@/lib/format";
import type { TimelineEvent } from "@/lib/queries";

type Kind = TimelineEvent["kind"];
const FILTERS: [Kind, string, IconName][] = [["decision", "Decisioni", "decision"], ["meeting", "Riunioni", "users"], ["note", "Note e idee", "note"], ["doc", "Documenti", "file"], ["task", "Attività", "tasks"]];
const ICON: Record<Kind, IconName> = { decision: "decision", meeting: "users", note: "note", doc: "file", task: "tasks" };
const RANGES: [number | null, string][] = [[7, "7 giorni"], [30, "30 giorni"], [90, "90 giorni"], [null, "Tutto"]];

function dayLabel(day: string) {
  const today = isoDay();
  const yesterday = isoDay(new Date(Date.now() - 86400000));
  if (day === today) return "Oggi";
  if (day === yesterday) return "Ieri";
  const d = new Date(day + "T12:00:00");
  const wd = new Intl.DateTimeFormat("it-IT", { weekday: "short" }).format(d);
  return `${wd} ${shortDate(d)}`;
}

export function TimelineView({ events }: { events: TimelineEvent[] }) {
  const [range, setRange] = useState<number | null>(30);
  const [off, setOff] = useState<Partial<Record<Kind, boolean>>>({});

  const since = range ? Date.now() - range * 86400000 : 0;
  const visible = events.filter((e) => !off[e.kind] && Date.parse(e.at) >= since);
  const days: [string, TimelineEvent[]][] = [];
  for (const e of visible) {
    const d = isoDay(new Date(e.at));
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(e);
    else days.push([d, [e]]);
  }

  return (
    <div className="page" style={{ maxWidth: 980, gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ margin: 0, fontSize: 40 }}>Timeline</h1>
          <div className="muted" style={{ fontSize: 14 }}>Tutto ciò che è entrato in memoria, in ordine di tempo.</div>
        </div>
        <div className="seg-sb">
          {RANGES.map(([r, l]) => <button key={l} aria-pressed={range === r} onClick={() => setRange(r)} style={{ height: 32, padding: "0 12px" }}>{l}</button>)}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FILTERS.map(([k, label, icon]) => {
          const on = !off[k];
          return (
            <button
              key={k}
              onClick={() => setOff((o) => ({ ...o, [k]: !o[k] }))}
              aria-pressed={on}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 11px", border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`, background: on ? "var(--sel)" : "transparent", color: on ? "var(--color-text)" : "var(--faint)", font: "inherit", fontSize: 13, cursor: "pointer" }}
            >
              <Icon name={icon} size={14} />{label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {!days.length ? (
          <div className="muted" style={{ padding: 48, textAlign: "center", border: "1px dashed var(--color-divider)" }}>
            {events.length ? "Nessun evento con questi filtri." : "La timeline si riempie man mano che confermi elementi in memoria."}
          </div>
        ) : days.map(([day, list]) => (
          <section key={day} className="tl-day" style={{ display: "grid", gridTemplateColumns: "130px minmax(0,1fr)", gap: 24 }}>
            <div className="muted" style={{ paddingTop: 18, fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17 }}>{dayLabel(day)}</div>
            <div style={{ borderLeft: "1px solid var(--color-divider)", padding: "10px 0 18px", display: "flex", flexDirection: "column", gap: 6 }}>
              {list.map((e) => (
                <div key={e.kind + e.id} style={{ position: "relative", paddingLeft: 28 }}>
                  <span style={{ position: "absolute", left: -5, top: 18, width: 9, height: 9, background: "var(--color-bg)", border: "1px solid var(--color-accent)" }} />
                  {e.kind === "decision" ? (
                    <Link href={e.href} style={{ color: "inherit", textDecoration: "none", display: "block", margin: "4px 0" }}>
                      <Blueprint className="card-hover" style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr)", gap: 12, padding: "14px 16px", borderColor: "var(--color-accent)" }}>
                        <span style={{ color: "var(--color-accent)", paddingTop: 3 }}><Icon name="decision" /></span>
                        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                          <span className="eyebrow" style={{ color: "var(--accent-text)" }}>Decisione</span>
                          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 20 }}>{e.title}</span>
                          {e.detail && <span className="muted" style={{ fontSize: 14 }}>{e.detail}</span>}
                          {e.conflict && <Flag text={e.conflict} />}
                        </span>
                      </Blueprint>
                    </Link>
                  ) : (
                    <Link href={e.href} className="row-hover" style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr)", gap: 12, padding: "10px 12px", color: "inherit", textDecoration: "none" }}>
                      <span className="muted" style={{ paddingTop: 2 }}><Icon name={ICON[e.kind]} /></span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 15 }}>{e.title}</span>
                        <span className="muted" style={{ fontSize: 12 }}>{e.meta}</span>
                        {e.conflict && <Flag text={e.conflict} />}
                      </span>
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Flag({ text }: { text: string }) {
  return <span style={{ fontSize: 12, color: "var(--danger)", display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}><Icon name="alert" size={13} />{text}</span>;
}
