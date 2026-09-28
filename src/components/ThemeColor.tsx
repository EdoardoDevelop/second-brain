"use client";

import { useEffect } from "react";

/** Colora la barra di stato del telefono (meta theme-color) con lo sfondo reale del tema, anche quando il tema cambia. */
export function ThemeColor() {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const sync = () => {
      const bg = getComputedStyle(document.body).backgroundColor;
      if (bg && meta.content !== bg) meta.content = bg;
    };
    sync();
    const obs = new MutationObserver(() => requestAnimationFrame(sync));
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    obs.observe(document.head, { childList: true, subtree: true, characterData: true });
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sync);
    window.addEventListener("sb-theme", sync);
    return () => { obs.disconnect(); media.removeEventListener("change", sync); window.removeEventListener("sb-theme", sync); };
  }, []);
  return null;
}
