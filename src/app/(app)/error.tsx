"use client";

import { useEffect } from "react";

const STALE = /server action|server reference/i;

/** Errore in una pagina. Se dipende da un aggiornamento dell'app (azioni della build precedente), ricarica da sola una volta. */
export default function PageError({ error, reset }: { error: Error; reset: () => void }) {
  const stale = STALE.test(error.message);
  useEffect(() => {
    if (!stale) return;
    try {
      // Evita un ciclo di ricariche se l'errore persiste.
      const last = Number(sessionStorage.getItem("sb_reloaded") ?? 0);
      if (Date.now() - last < 30000) return;
      sessionStorage.setItem("sb_reloaded", String(Date.now()));
    } catch {}
    location.reload();
  }, [stale]);

  return (
    <div style={{ padding: "48px 24px", maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      <h3 style={{ margin: 0 }}>{stale ? "L'app è stata aggiornata" : "Qualcosa non ha funzionato"}</h3>
      <p className="muted" style={{ margin: 0 }}>{stale ? "Ricarico la pagina…" : error.message || "Errore imprevisto."}</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" onClick={() => location.reload()}>Ricarica la pagina</button>
        {!stale && <button className="btn btn-secondary" onClick={reset}>Riprova</button>}
      </div>
    </div>
  );
}
