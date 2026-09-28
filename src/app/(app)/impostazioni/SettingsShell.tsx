"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import type { IconName } from "@/lib/icons";

export type SettingsSection = { id: string; title: string; icon: IconName; desc: string; content: ReactNode };

/**
 * Impostazioni divise in sezioni: menu laterale sul computer, schede scorrevoli in alto sul telefono.
 * Si vede una sezione alla volta; l'indirizzo la ricorda (#ia, #aspetto…), così si può tornare o condividere il link.
 */
export function SettingsShell({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0].id);

  useEffect(() => {
    const fromHash = () => {
      const h = location.hash.slice(1);
      if (sections.some((s) => s.id === h)) setActive(h);
    };
    fromHash();
    addEventListener("hashchange", fromHash);
    return () => removeEventListener("hashchange", fromHash);
  }, [sections]);

  const open = (id: string) => {
    setActive(id);
    history.replaceState(null, "", `#${id}`);
    document.querySelector(".set-main")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const cur = sections.find((s) => s.id === active) ?? sections[0];

  return (
    <div className="set-shell">
      <nav className="set-nav" aria-label="Sezioni delle impostazioni">
        {sections.map((s) => (
          <button key={s.id} className="set-nav-btn" aria-current={s.id === cur.id ? "page" : undefined} onClick={() => open(s.id)}>
            <Icon name={s.icon} size={16} />
            <span>{s.title}</span>
          </button>
        ))}
      </nav>
      <div className="set-main">
        <header className="set-head" key={cur.id}>
          <h2>{cur.title}</h2>
          <p className="muted">{cur.desc}</p>
        </header>
        {/* Tutte le sezioni restano montate: si perdono meno stati (bozze, liste caricate) cambiando scheda. */}
        {sections.map((s) => (
          <div key={s.id} className="set-body" hidden={s.id !== cur.id}>{s.content}</div>
        ))}
      </div>
    </div>
  );
}

/** Riquadro di una sezione: titolo, descrizione facoltativa, contenuto. `tone="danger"` per le azioni irreversibili. */
export function SetCard({ title, desc, icon, aside, tone, children }: { title: string; desc?: ReactNode; icon?: IconName; aside?: ReactNode; tone?: "danger"; children: ReactNode }) {
  return (
    <section className="set-card" data-tone={tone}>
      <div className="set-card-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{icon && <Icon name={icon} size={15} />}{title}</h3>
          {desc && <div className="muted set-card-desc">{desc}</div>}
        </div>
        {aside}
      </div>
      <div className="set-card-body">{children}</div>
    </section>
  );
}
