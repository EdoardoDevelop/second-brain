"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import { runBackupNow } from "@/lib/actions";
import type { BackupStatus } from "@/lib/backup";

const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const when = (ms: number) => new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(ms);

/** Backup automatico del database: stato dell'ultimo, copie tenute, «fai ora» e download per una copia fuori dal server. */
export function BackupCard({ initial, copies }: { initial: BackupStatus | null; copies: { day: string; size: number }[] }) {
  const [status, setStatus] = useState(initial);
  const [list, setList] = useState(copies);
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    const r = await runBackupNow();
    setStatus(r.status);
    setList(r.copies);
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 14 }}>
        {!status ? <span className="muted">Nessun backup ancora: il primo parte stanotte alle 2:30, oppure fallo ora.</span>
          : status.error ? <span style={{ color: "var(--danger)" }}>{when(status.at)} · errore: {status.error}</span>
          : <span>Ultimo: <b style={{ fontWeight: 500 }}>{when(status.at)}</b> · {size(status.size)}{status.files ? ` · ${status.files} allegati nuovi copiati` : ""} · {list.length} {list.length === 1 ? "copia tenuta" : "copie tenute"}</span>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-secondary" onClick={run} disabled={pending} style={{ gap: 6 }}>{pending ? <span className="spin" /> : <Icon name="refresh" size={14} />}Fai un backup ora</button>
        {list.length > 0 && <a className="btn btn-secondary" href="/api/backup" style={{ gap: 6 }}><Icon name="download" />Scarica l&apos;ultimo</a>}
      </div>
      {list.length > 1 && (
        <details>
          <summary className="muted" style={{ fontSize: 13, cursor: "pointer" }}>Tutte le copie</summary>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {list.map((c) => <a key={c.day} className="nw-topic" href={`/api/backup?day=${c.day}`} style={{ textDecoration: "none" }}>{c.day.split("-").reverse().join("/")} · {size(c.size)}</a>)}
          </div>
        </details>
      )}
    </div>
  );
}
