import type { Sky } from "@/lib/weather";

/** Nuvola con la base su y=46, larga circa 42 (da x≈9 a x≈55). */
const CLOUD = "M20 46h25a9.5 9.5 0 0 0 1.3-18.9A14 14 0 0 0 19.6 23 11.5 11.5 0 0 0 20 46z";
const BOLT = "M33 40l-7 11h6l-3 9 9-12h-6l4-8z";

function Sun({ x = 32, y = 32, r = 10 }: { x?: number; y?: number; r?: number }) {
  return (
    <g className="wx-sun">
      <circle className="wx-glow" cx={x} cy={y} r={r * 1.7} />
      <g className="wx-rays" style={{ transformOrigin: `${x}px ${y}px` }}>
        {Array.from({ length: 8 }, (_, k) => {
          const a = (k * Math.PI) / 4;
          return <line key={k} x1={x + Math.cos(a) * r * 1.45} y1={y + Math.sin(a) * r * 1.45} x2={x + Math.cos(a) * r * 1.9} y2={y + Math.sin(a) * r * 1.9} />;
        })}
      </g>
      <circle className="wx-core" cx={x} cy={y} r={r} />
    </g>
  );
}

function Moon({ x = 32, y = 30, r = 12, stars = true }: { x?: number; y?: number; r?: number; stars?: boolean }) {
  return (
    <g className="wx-moon-g">
      {stars && (
        <g className="wx-stars">
          <circle cx={x - r * 1.5} cy={y - r * 0.9} r="1.3" />
          <circle cx={x + r * 1.4} cy={y - r * 1.2} r="1" />
          <circle cx={x + r * 1.6} cy={y + r * 0.6} r="1.2" />
        </g>
      )}
      <path className="wx-moon" d={`M${x + r * 0.35} ${y - r}a${r} ${r} 0 1 0 ${r * 0.65} ${r * 1.55}A${r * 0.8} ${r * 0.8} 0 0 1 ${x + r * 0.35} ${y - r}z`} />
    </g>
  );
}

function Drops({ n, snow = false, short = false }: { n: number; snow?: boolean; short?: boolean }) {
  const xs = n === 2 ? [26, 38] : n === 3 ? [23, 32, 41] : [21, 28, 35, 42];
  return (
    <g className={snow ? "wx-flakes" : "wx-drops"}>
      {xs.map((x, k) => snow
        ? <circle key={k} cx={x} cy={50} r="1.8" style={{ animationDelay: `${k * 0.45}s` }} />
        : <line key={k} x1={x} y1={49} x2={x - 2} y2={short ? 53 : 56} style={{ animationDelay: `${k * 0.27}s` }} />)}
    </g>
  );
}

/**
 * Icona meteo animata (solo CSS, vedi .wx-* in globals.css). `still` la ferma (icone piccole, animazioni spente);
 * con prefers-reduced-motion si ferma comunque.
 */
export function WeatherIcon({ sky, day, size = 64, still = false }: { sky: Sky; day: boolean; size?: number; still?: boolean }) {
  const cloud = (cls = "", t?: string) => <path className={`wx-cloud ${cls}`} d={CLOUD} transform={t} />;
  const body = (() => {
    switch (sky) {
      case "clear":
        return day ? <Sun /> : <Moon />;
      case "partly":
        return (
          <>
            {day ? <Sun x={24} y={24} r={8} /> : <Moon x={24} y={22} r={9} stars={false} />}
            <g className="wx-drift">{cloud("", "translate(4 4)")}</g>
          </>
        );
      case "cloudy":
        return (
          <>
            <g className="wx-drift-slow">{cloud("wx-cloud-back", "translate(-6 -9) scale(.85)")}</g>
            <g className="wx-drift">{cloud("", "translate(3 2)")}</g>
          </>
        );
      case "fog":
        return (
          <>
            {cloud("wx-cloud-back", "translate(0 -6)")}
            <g className="wx-fog">
              <line x1="12" y1="47" x2="44" y2="47" />
              <line x1="20" y1="53" x2="52" y2="53" style={{ animationDelay: "-1.5s" }} />
              <line x1="14" y1="59" x2="40" y2="59" style={{ animationDelay: "-3s" }} />
            </g>
          </>
        );
      case "drizzle":
      case "rain":
        return (
          <>
            <Drops n={sky === "drizzle" ? 3 : 4} short={sky === "drizzle"} />
            <g className="wx-drift">{cloud(sky === "rain" ? "wx-cloud-rain" : "", "translate(0 -6)")}</g>
          </>
        );
      case "snow":
        return (
          <>
            <Drops n={3} snow />
            <g className="wx-drift">{cloud("", "translate(0 -6)")}</g>
          </>
        );
      case "storm":
        return (
          <>
            <Drops n={2} />
            <path className="wx-bolt" d={BOLT} transform="translate(0 -4)" />
            <g className="wx-drift">{cloud("wx-cloud-storm", "translate(0 -8)")}</g>
          </>
        );
    }
  })();
  return (
    <svg className="wx-icon" data-still={still || undefined} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ overflow: "visible" }}>
      {body}
    </svg>
  );
}
