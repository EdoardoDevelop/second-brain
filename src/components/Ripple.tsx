"use client";

import { useEffect } from "react";

/** Elementi che ricevono l'effetto "ripple" di Android al tocco. */
const TARGETS = ".btn, .list-btn, .sb-nav-btn, .suggestion, .seg-sb button, .scope-btn, .source-chip, .side-row, .chat-item > button, .cmd-example, [data-ripple]";

/** Onda che parte dal punto toccato, come nei pulsanti di Android. Un solo listener per tutta l'app. */
export function Ripple() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(TARGETS);
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return;
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      // Contenitore che ritaglia l'onda sui bordi (e sugli angoli arrotondati) dell'elemento.
      let host = el.querySelector<HTMLElement>(":scope > .ripple-host");
      if (!host) {
        host = document.createElement("span");
        host.className = "ripple-host";
        el.appendChild(host);
      }
      const r = el.getBoundingClientRect();
      const size = Math.hypot(r.width, r.height) * 2;
      const wave = document.createElement("span");
      wave.className = "ripple";
      wave.style.width = wave.style.height = `${size}px`;
      wave.style.left = `${e.clientX - r.left - size / 2}px`;
      wave.style.top = `${e.clientY - r.top - size / 2}px`;
      host.appendChild(wave);
      const release = () => {
        wave.classList.add("ripple-out");
        window.setTimeout(() => wave.remove(), 450);
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
      };
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}
