"use client";

import { useEffect } from "react";

/**
 * Dopo un aggiornamento dell'app, una pagina rimasta aperta chiamerebbe server action che non esistono più.
 * Quando la scheda torna visibile si confronta la build del server con la propria e, se è cambiata, si ricarica.
 */
export function VersionWatch() {
  useEffect(() => {
    // Service worker minimo: serve a rendere l'app installabile (e al «Condividi» di Android).
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    const mine = process.env.NEXT_PUBLIC_BUILD_ID;
    if (!mine) return;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { build } = await res.json();
        if (build && build !== mine) location.reload();
      } catch {}
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => { document.removeEventListener("visibilitychange", check); window.removeEventListener("focus", check); };
  }, []);
  return null;
}
