"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CommandBar } from "@/components/CommandBar";
import { VersionWatch } from "@/components/VersionWatch";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Blueprint, Icon } from "./ui";
import type { IconName } from "@/lib/icons";
import { logout } from "@/lib/actions";

const NAV: [string, string, IconName][] = [
  ["/", "Home", "home"],
  ["/inbox", "Inbox", "inbox"],
  ["/conoscenza", "Conoscenza", "book"],
  ["/progetti", "Progetti", "folder"],
  ["/obiettivi", "Obiettivi", "target"],
  ["/persone", "Persone", "users"],
  ["/attivita", "Attività", "tasks"],
  ["/timeline", "Timeline", "timeline"],
  ["/connessioni", "Connessioni", "graph"],
  ["/assistente", "Assistente", "ai"],
  ["/memoria", "Cosa so di te", "user"],
];

const TITLES: Record<string, string> = Object.fromEntries([...NAV.map(([h, l]) => [h, l]), ["/impostazioni", "Impostazioni"], ["/quadro", "Quadro completo"]]);

function section(path: string) {
  if (path === "/") return "/";
  return "/" + path.split("/")[1];
}

/** Tema effettivamente visibile: in modalità automatica dipende dal dispositivo. */
function effectiveTheme(): "dark" | "light" {
  const t = document.body.dataset.theme;
  if (t === "auto") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return t === "light" ? "light" : "dark";
}

export function AppShell({ children, inboxCount }: { children: ReactNode; inboxCount: number }) {
  const path = usePathname();
  const router = useRouter();
  const cur = section(path);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [palette, setPalette] = useState(false);
  const [command, setCommand] = useState<null | "text" | "voice">(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setTheme(effectiveTheme());
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setCommand((c) => (c ? null : "text")); }
      else if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    // Il tema può cambiare anche dalle Impostazioni.
    const onTheme = () => setTheme(effectiveTheme());
    window.addEventListener("sb-theme", onTheme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", onTheme);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("sb-theme", onTheme); media.removeEventListener("change", onTheme); };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    mainRef.current?.scrollTo(0, 0);
  }, [path]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.body.dataset.theme = next;
    document.cookie = `sb_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    window.dispatchEvent(new Event("sb-theme"));
  };

  const showLabels = !collapsed || mobileOpen;

  return (
    <div className="sb-root">
      <VersionWatch />
      <aside className="sb-side" data-open={mobileOpen} style={{ width: collapsed ? 60 : 232 }}>
        <div style={{ height: 56, flex: "none", display: "flex", alignItems: "center", gap: 11, padding: "0 19px", borderBottom: "1px solid var(--color-divider)" }}>
          <Logo size={26} />
          {showLabels && <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 20, letterSpacing: "-.01em", whiteSpace: "nowrap" }}>Second Brain</div>}
        </div>
        <nav style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV.map(([href, label, icon]) => (
            <Link key={href} href={href} className="sb-nav-btn" title={label} aria-current={cur === href ? "page" : undefined}>
              <Icon name={icon} />
              {showLabels && <span style={{ flex: 1 }}>{label}</span>}
              {href === "/inbox" && inboxCount > 0 && showLabels && <span className="sb-badge">{inboxCount}</span>}
            </Link>
          ))}
        </nav>
        <div style={{ flex: "none", borderTop: "1px solid var(--color-divider)", padding: 10, display: "flex", flexDirection: "column", gap: 2 }}>
          <Link href="/impostazioni" className="sb-nav-btn" title="Impostazioni" aria-current={cur === "/impostazioni" ? "page" : undefined}>
            <Icon name="settings" />
            {showLabels && <span>Impostazioni</span>}
          </Link>
          <button className="sb-nav-btn only-mobile" onClick={toggleTheme} title="Cambia tema">
            <Icon name={theme === "dark" ? "sun" : "moon"} />
            <span>{theme === "dark" ? "Tema chiaro" : "Tema scuro"}</span>
          </button>
          <form action={logout}>
            <button className="sb-nav-btn" title="Esci">
              <Icon name="arrowUR" />
              {showLabels && <span>Esci</span>}
            </button>
          </form>
        </div>
      </aside>
      {mobileOpen && <div className="sb-scrim" onClick={() => setMobileOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30, background: "rgba(0,0,0,.35)" }} />}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header className="sb-header">
          <button className="btn btn-ghost btn-icon hide-mobile" onClick={() => setCollapsed((c) => !c)} title="Comprimi barra laterale" style={{ color: "var(--muted)" }}>
            <Icon name="panel" />
          </button>
          <button className="btn btn-ghost btn-icon only-mobile" onClick={() => setMobileOpen(true)} title="Menu" style={{ color: "var(--muted)" }}>
            <Icon name="panel" />
          </button>
          <div className="sb-title" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, minWidth: 0, flex: 1 }}>
            <Link href={cur} className="ellipsis" style={{ color: "var(--color-text)", textDecoration: "none", whiteSpace: "nowrap" }}>{TITLES[cur] ?? ""}</Link>
          </div>
          <button className="sb-search" onClick={() => setPalette(true)} aria-label="Cerca">
            <Icon name="search" />
            <span style={{ flex: 1 }} className="ellipsis sb-search-label">Cerca nel Second Brain…</span>
            <span className="kbd">⌘K</span>
          </button>
          <button className="btn btn-ghost btn-icon hide-mobile" onClick={toggleTheme} title="Cambia tema" style={{ color: "var(--muted)" }}>
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
          <button className="btn btn-ghost btn-icon hide-mobile" onClick={() => setCommand("text")} title="Comando all'IA (⌘J)" style={{ color: "var(--muted)" }}>
            <Icon name="ai" />
          </button>
          <button className="btn btn-secondary btn-icon" onClick={() => setCommand("voice")} title="Detta un comando" aria-label="Detta un comando">
            <Icon name="mic" />
          </button>
          <button className="btn btn-primary sb-capture" onClick={() => router.push("/inbox")} aria-label="Cattura" style={{ height: 34, gap: 6 }}>
            <Icon name="plus" />
            <span className="hide-mobile">Cattura</span>
          </button>
        </header>
        <main ref={mainRef} className="sb-main">{children}</main>
      </div>

      {palette && <Palette onClose={() => setPalette(false)} />}
      {command && <CommandBar startRecording={command === "voice"} onClose={() => setCommand(null)} />}
    </div>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const go = (href: string) => { onClose(); router.push(href); };
  const items: [string, string, IconName][] = [
    ["/inbox", "Nuova cattura", "plus"],
    ["/conoscenza", "Apri Conoscenza", "book"],
    ["/attivita", "Apri Attività", "tasks"],
  ];
  return (
    <div className="sb-scrim" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "color-mix(in srgb, #000 45%, transparent)", display: "flex", justifyContent: "center", paddingTop: "12vh", paddingInline: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(680px, 100%)", height: "fit-content" }}>
        <Blueprint className="sb-dialog" style={{ background: "var(--raised)", boxShadow: "var(--shadow-lg)" }}>
          <form
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) go("/conoscenza?q=" + encodeURIComponent(q.trim())); }}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 18px", height: 56, borderBottom: "1px solid var(--color-divider)" }}
          >
            <Icon name="search" size={20} style={{ color: "var(--muted)" }} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nella memoria…" style={{ flex: 1, border: 0, background: "none", color: "var(--color-text)", font: "inherit", fontSize: 17, outline: "none" }} />
            <span className="kbd">Esc</span>
          </form>
          <div style={{ padding: "8px 8px 10px", display: "flex", flexDirection: "column" }}>
            {items.map(([href, label, icon]) => (
              <button key={href} onClick={() => go(href)} className="side-row" style={{ justifyContent: "flex-start", gap: 12, height: 38 }}>
                <Icon name={icon} />
                {label}
              </button>
            ))}
          </div>
          <div style={{ padding: "8px 18px", borderTop: "1px solid var(--color-divider)", fontSize: 12 }} className="muted">↵ cerca · Esc chiudi · ⌘K ovunque</div>
        </Blueprint>
      </div>
    </div>
  );
}
