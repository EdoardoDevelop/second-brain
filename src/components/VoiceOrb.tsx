"use client";

import { useEffect, useRef } from "react";

type Mode = "listening" | "thinking" | "idle";

/** Colore d'accento del tema come [r, g, b] (il valore CSS può essere un color-mix: si legge quello calcolato). */
function accentRgb(el: HTMLElement): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = "var(--color-accent)";
  el.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const n = c.match(/[\d.]+/g)?.map(Number) ?? [];
  // "color(srgb 0.3 0.5 0.6)" ha valori 0-1, "rgb(77, 128, 166)" 0-255.
  if (c.startsWith("color(") && n.length >= 3) return [n[0]! * 255, n[1]! * 255, n[2]! * 255];
  return n.length >= 3 ? [n[0]!, n[1]!, n[2]!] : [89, 128, 166];
}

/**
 * Sfera animata dell'ascolto. Con `analyser` segue la voce: le forme si gonfiano con il volume
 * e la corona di barre mostra le frequenze. Senza, "respira" (idle) o ruota lentamente (thinking).
 */
export function VoiceOrb({ analyser, mode = "listening", size = 200 }: { analyser?: AnalyserNode | null; mode?: Mode; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ analyser, mode });
  live.current = { analyser, mode };

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * dpr;
    cv.height = size * dpr;
    ctx.scale(dpr, dpr);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let [r, g, b] = accentRgb(cv.parentElement ?? document.body);
    const rgba = (a: number) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
    // Il tema può cambiare mentre l'animazione è aperta.
    const onTheme = () => { [r, g, b] = accentRgb(cv.parentElement ?? document.body); };
    window.addEventListener("sb-theme", onTheme);

    const bins = new Uint8Array(128);
    const BARS = 56;
    const bars = new Float32Array(BARS);
    let level = 0;
    let frame = 0;
    const c = size / 2;
    const base = size * 0.24;
    const t0 = performance.now();

    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const { analyser: an, mode: m } = live.current;
      let target = 0;
      if (an && m === "listening") {
        an.getByteFrequencyData(bins);
        // Voce: soprattutto le frequenze basse e medie.
        let sum = 0;
        for (let i = 2; i < 48; i++) sum += bins[i]!;
        target = Math.min(1, (sum / 46 / 255) * 1.8);
        for (let k = 0; k < BARS; k++) {
          // Corona simmetrica: metà sinistra e metà destra specchiate.
          const idx = 2 + Math.floor((k < BARS / 2 ? k : BARS - 1 - k) * 1.4);
          bars[k] = bars[k]! * 0.6 + ((bins[idx] ?? 0) / 255) * 0.4;
        }
      } else {
        target = m === "thinking" ? 0.25 + 0.1 * Math.sin(t * 3) : 0.08 + 0.05 * Math.sin(t * 1.6);
        for (let k = 0; k < BARS; k++) {
          const wave = m === "thinking" ? Math.max(0, Math.sin(k / BARS * Math.PI * 2 * 3 - t * 4)) * 0.5 : 0.06;
          bars[k] = bars[k]! * 0.85 + wave * 0.15;
        }
      }
      level += (target - level) * 0.18;

      ctx.clearRect(0, 0, size, size);

      // Alone.
      const glowR = base * (1.9 + level * 0.9);
      const glow = ctx.createRadialGradient(c, c, base * 0.4, c, c, glowR);
      glow.addColorStop(0, rgba(0.35 + level * 0.25));
      glow.addColorStop(1, rgba(0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(c, c, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Corona di barre.
      const ringR = base * 1.28 + level * base * 0.2;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1.5, size / 110);
      const spin = m === "thinking" ? t * 0.8 : t * 0.08;
      for (let k = 0; k < BARS; k++) {
        const a = (k / BARS) * Math.PI * 2 + spin;
        const len = 2 + bars[k]! * base * 0.75;
        ctx.strokeStyle = rgba(0.25 + bars[k]! * 0.65);
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * ringR, c + Math.sin(a) * ringR);
        ctx.lineTo(c + Math.cos(a) * (ringR + len), c + Math.sin(a) * (ringR + len));
        ctx.stroke();
      }

      // Forme morbide sovrapposte, dalla più esterna e trasparente alla più interna e piena.
      const layers = [
        { scale: 1.12, alpha: 0.22, speed: 0.7, lobes: 3, phase: 0 },
        { scale: 1.0, alpha: 0.38, speed: -0.9, lobes: 4, phase: 1.7 },
        { scale: 0.84, alpha: 0.95, speed: 1.2, lobes: 5, phase: 3.1 },
      ];
      for (const L of layers) {
        ctx.beginPath();
        const N = 72;
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2;
          const wobble = reduce ? 0 : Math.sin(a * L.lobes + t * L.speed + L.phase) * (0.05 + level * 0.14) + Math.sin(a * (L.lobes + 2) - t * L.speed * 1.3) * (0.03 + level * 0.08);
          const rr = base * L.scale * (1 + level * 0.22 + wobble);
          const x = c + Math.cos(a) * rr;
          const y = c + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const grad = ctx.createRadialGradient(c - base * 0.3, c - base * 0.35, base * 0.1, c, c, base * L.scale * 1.3);
        grad.addColorStop(0, `rgba(255,255,255,${L.alpha * 0.55})`);
        grad.addColorStop(0.35, rgba(L.alpha));
        grad.addColorStop(1, rgba(L.alpha * 0.8));
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Riflesso.
      const hl = ctx.createRadialGradient(c - base * 0.28, c - base * 0.32, 0, c - base * 0.28, c - base * 0.32, base * 0.45);
      hl.addColorStop(0, "rgba(255,255,255,.45)");
      hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hl;
      ctx.beginPath();
      ctx.arc(c - base * 0.28, c - base * 0.32, base * 0.45, 0, Math.PI * 2);
      ctx.fill();

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("sb-theme", onTheme); };
  }, [size]);

  return <canvas ref={canvas} style={{ width: size, height: size, display: "block", flex: "none" }} aria-hidden="true" />;
}
