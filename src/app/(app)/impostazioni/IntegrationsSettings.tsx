"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import { addWebhook, createKey, deleteWebhook, revokeKey, testWebhook } from "@/lib/actions";

type Key = { id: string; name: string; prefix: string; scope: "read" | "write"; created: string; lastUsed: string | null };
type Hook = { id: string; url: string; events: string[]; lastStatus: string | null; lastAt: string | null };

const EVENTS: [string, string][] = [
  ["item.captured", "Nuova cattura"], ["item.confirmed", "Elemento confermato"], ["task.created", "Attività creata"], ["task.completed", "Attività completata"],
];

function Copy({ text, label = "Copia" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-secondary" style={{ height: 30, flex: "none" }}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {} }}>
      {done ? "Copiato" : label}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <pre style={{ margin: 0, flex: 1, minWidth: 0, padding: "10px 12px", background: "var(--color-surface)", border: "1px solid var(--color-divider)", fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }}>{children}</pre>
      <Copy text={children} />
    </div>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
      {children}
    </div>
  );
}

export function IntegrationsSettings({ base, keys, hooks }: { base: string; keys: Key[]; hooks: Hook[] }) {
  const [name, setName] = useState("Claude");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [fresh, setFresh] = useState<{ secret: string; name: string } | null>(null);
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>(EVENTS.map(([e]) => e));
  const [hookSecret, setHookSecret] = useState<string | null>(null);
  const [hookMsg, setHookMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mcp = `${base}/api/mcp`;
  const row = { padding: "14px 0", borderTop: "1px solid var(--color-divider)", display: "flex", flexDirection: "column" as const, gap: 10 };

  const create = () => start(async () => { const r = await createKey(name, scope); setFresh({ secret: r.secret, name: name.trim() || "Chiave" }); });

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* ——— Chiavi ——— */}
      <div style={row}>
        <div><div style={{ fontSize: 15 }}>Chiavi di accesso</div><div className="muted" style={{ fontSize: 13 }}>Servono a Claude (MCP o skill) e a qualsiasi app che usa l&apos;API. Una chiave si vede una sola volta: se la perdi, creane un&apos;altra.</div></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (es. Claude Code)" maxLength={60} style={{ width: 200, height: 34 }} />
          <div className="seg-sb">
            <button aria-pressed={scope === "write"} onClick={() => setScope("write")} style={{ height: 34, padding: "0 12px" }}>Lettura e scrittura</button>
            <button aria-pressed={scope === "read"} onClick={() => setScope("read")} style={{ height: 34, padding: "0 12px" }}>Sola lettura</button>
          </div>
          <button className="btn btn-primary" onClick={create} disabled={pending} style={{ height: 34 }}>Crea chiave</button>
        </div>

        {fresh && (
          <div className="blueprint" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, background: "var(--raised)" }}>
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-text)", fontSize: 14, fontWeight: 500 }}><Icon name="lock" size={16} />Chiave «{fresh.name}» creata: copiala ora, poi non sarà più visibile.</div>
            <Code>{fresh.secret}</Code>
            <Step title="Claude Code (consigliato): collega Second Brain come server MCP">
              <Code>{`claude mcp add --transport http second-brain ${mcp} --header "Authorization: Bearer ${fresh.secret}"`}</Code>
            </Step>
            <Step title="claude.ai o Claude Desktop: Impostazioni → Connettori → Aggiungi connettore personalizzato, con questo URL">
              <Code>{`${mcp}?key=${fresh.secret}`}</Code>
              <span className="muted" style={{ fontSize: 12 }}>L&apos;URL contiene la chiave: trattalo come una password.</span>
            </Step>
            <Step title="Skill per Claude: istruzioni su quando e come usare Second Brain (Claude Code: estrai in ~/.claude/skills/; claude.ai: Impostazioni → Capacità → Skill → Carica)">
              <form method="post" action="/api/skill" style={{ display: "flex", gap: 8 }}>
                <input type="hidden" name="key" value={fresh.secret} />
                <input type="hidden" name="base" value={base} />
                <button className="btn btn-secondary" style={{ gap: 6 }}><Icon name="download" size={14} />Scarica la skill (.zip) con questa chiave</button>
              </form>
            </Step>
            <Step title="API REST (script, Comandi rapidi di iPhone, n8n…)">
              <Code>{`curl -s ${base}/api/v1/today -H "Authorization: Bearer ${fresh.secret}"`}</Code>
              <span className="muted" style={{ fontSize: 12 }}>Elenco degli endpoint: <a href={`${base}/api/v1`} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{base}/api/v1</a></span>
            </Step>
            <button className="btn btn-ghost" onClick={() => setFresh(null)} style={{ alignSelf: "flex-end" }}>Ho copiato, chiudi</button>
          </div>
        )}

        {keys.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {keys.map((k) => (
              <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--color-divider)", flexWrap: "wrap", fontSize: 14 }}>
                <Icon name="lock" size={14} style={{ color: "var(--muted)" }} />
                <span style={{ fontWeight: 500 }}>{k.name}</span>
                <code className="muted" style={{ fontSize: 12 }}>{k.prefix}…</code>
                <span className="muted" style={{ fontSize: 12 }}>{k.scope === "write" ? "lettura e scrittura" : "sola lettura"} · creata {k.created} · {k.lastUsed ? `usata ${k.lastUsed}` : "mai usata"}</span>
                <span style={{ flex: 1 }} />
                <button className="btn btn-ghost" style={{ height: 28, color: "var(--danger)" }} disabled={pending}
                  onClick={() => { if (window.confirm(`Revocare la chiave «${k.name}»? Chi la usa perderà l'accesso.`)) start(() => revokeKey(k.id)); }}>Revoca</button>
              </div>
            ))}
          </div>
        )}
        {!fresh && (
          <form method="post" action="/api/skill" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="base" value={base} />
            <span className="muted" style={{ fontSize: 13 }}>Skill senza chiave (la leggerà dalla variabile SECOND_BRAIN_KEY):</span>
            <button className="btn btn-ghost" style={{ height: 30, gap: 6 }}><Icon name="download" size={14} />Scarica</button>
          </form>
        )}
      </div>

      {/* ——— Webhook ——— */}
      <div style={row}>
        <div><div style={{ fontSize: 15 }}>Webhook in uscita</div><div className="muted" style={{ fontSize: 13 }}>Second Brain avvisa un tuo indirizzo (n8n, Zapier, Make, un server…) con un POST JSON firmato quando succede qualcosa.</div></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="input" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://…" style={{ flex: "1 1 260px", height: 34 }} />
          <button className="btn btn-primary" style={{ height: 34 }} disabled={pending || !hookUrl.trim()}
            onClick={() => start(async () => { setHookMsg(null); const r = await addWebhook(hookUrl, hookEvents); if ("error" in r) setHookMsg(r.error ?? null); else { setHookSecret(r.secret); setHookUrl(""); } })}>Aggiungi</button>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {EVENTS.map(([e, label]) => (
            <label key={e} className="muted" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={hookEvents.includes(e)} onChange={(x) => setHookEvents((list) => (x.target.checked ? [...list, e] : list.filter((y) => y !== e)))} />{label}
            </label>
          ))}
        </div>
        {hookMsg && <div className="alert"><Icon name="alert" style={{ color: "var(--danger)" }} /><span>{hookMsg}</span></div>}
        {hookSecret && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13 }}>Segreto per verificare la firma (header <code>X-SecondBrain-Signature: sha256=…</code>, HMAC-SHA256 del corpo). Si vede solo ora:</span>
            <Code>{hookSecret}</Code>
          </div>
        )}
        {hooks.map((h) => (
          <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--color-divider)", flexWrap: "wrap", fontSize: 14 }}>
            <span className="ellipsis" style={{ flex: "1 1 240px", minWidth: 0 }}>{h.url}</span>
            <span className="muted" style={{ fontSize: 12 }}>{h.events.length} eventi{h.lastStatus ? ` · ultimo invio: ${h.lastStatus}${h.lastAt ? ` (${h.lastAt})` : ""}` : ""}</span>
            <button className="btn btn-ghost" style={{ height: 28 }} disabled={pending} onClick={() => start(async () => { const s = await testWebhook(h.id); setHookMsg(`Prova inviata: risposta ${s}`); })}>Prova</button>
            <button className="btn btn-ghost" style={{ height: 28, color: "var(--danger)" }} disabled={pending} onClick={() => { if (window.confirm("Eliminare questo webhook?")) start(() => deleteWebhook(h.id)); }}>Elimina</button>
          </div>
        ))}
      </div>
    </div>
  );
}
