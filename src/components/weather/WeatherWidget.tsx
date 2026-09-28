"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import { findPlaces, saveWeatherConfig } from "@/lib/actions";
import { describe, type Place, type Weather, type WeatherConfig } from "@/lib/weather";
import { WeatherIcon } from "./WeatherIcon";

const DAY = new Intl.DateTimeFormat("it-IT", { weekday: "short", timeZone: "UTC" });
const dayName = (iso: string, k: number) => (k === 0 ? "Oggi" : k === 1 ? "Domani" : DAY.format(new Date(iso + "T12:00:00Z")).replace(".", ""));
const round = (n: number) => Math.round(n);

/** Numero che sale fino al valore (una volta, all'apertura o quando cambia). */
function CountUp({ value, animate }: { value: number; animate: boolean }) {
  const [shown, setShown] = useState(animate ? value - 6 : value);
  useEffect(() => {
    if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return setShown(value);
    const from = value - 6, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      setShown(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, animate]);
  return <>{round(shown)}</>;
}

/** Riquadro Meteo della Home: condizioni attuali, prossime ore, prossimi giorni; impostazioni dall'ingranaggio. */
export function WeatherWidget({ config, weather }: { config: WeatherConfig; weather: Weather | null }) {
  const [cfg, setCfg] = useState(config);
  const [editing, setEditing] = useState(!config.place);
  const [pending, start] = useTransition();
  useEffect(() => setCfg(config), [config]);

  const save = (next: WeatherConfig) => {
    setCfg(next);
    start(() => saveWeatherConfig(next));
  };

  const now = weather?.now;
  const d = now ? describe(now.code) : null;
  const days = weather?.days.slice(0, cfg.days) ?? [];
  const lo = Math.min(...days.map((x) => x.min)), hi = Math.max(...days.map((x) => x.max));
  const u = weather?.units.temp ?? "°";

  return (
    <div className="wx" data-anim={cfg.animate ? "on" : "off"}>
      {d && cfg.animate && <div className="wx-sky" data-sky={d.sky} data-day={now!.day ? "1" : "0"} aria-hidden="true"><i /><i /><i /></div>}

      <div className="wx-top">
        <span className="muted ellipsis" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <Icon name="pin" size={13} />
          <span className="ellipsis">{cfg.place ? cfg.place.name : "Nessun luogo"}</span>
          {now && <span className="faint" style={{ whiteSpace: "nowrap" }}>· {now.time.slice(11, 16)}</span>}
        </span>
        <button className="btn btn-ghost btn-icon" onClick={() => setEditing((e) => !e)} aria-label="Impostazioni del meteo" aria-expanded={editing} title="Impostazioni" style={{ height: 30, width: 30, color: editing ? "var(--accent-text)" : "var(--muted)" }}>
          <Icon name={editing ? "x" : "settings"} size={15} />
        </button>
      </div>

      {editing ? (
        <Settings cfg={cfg} save={save} pending={pending} onDone={() => setEditing(false)} />
      ) : !cfg.place ? (
        <div className="muted" style={{ fontSize: 14, padding: "12px 0" }}>Scegli una città dalle impostazioni.</div>
      ) : !weather || !d || !now ? (
        <div className="muted" style={{ fontSize: 14, padding: "12px 0" }}>Meteo non disponibile in questo momento. Riprovo al prossimo aggiornamento.</div>
      ) : (
        <>
          <div className="wx-now">
            <div className="wx-big-icon"><WeatherIcon sky={d.sky} day={now.day} size={84} still={!cfg.animate} /></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <div className="wx-temp"><CountUp value={now.temp} animate={cfg.animate} /><span className="wx-deg">{u}</span></div>
              <div style={{ fontSize: 15 }}>{d.label}</div>
              {days[0] && <div className="muted" style={{ fontSize: 13 }}>Max {round(days[0].max)}{u} · Min {round(days[0].min)}{u}</div>}
            </div>
          </div>

          {cfg.details && (
            <div className="wx-details">
              <span><small>Percepita</small>{round(now.feels)}{u}</span>
              <span><small>Umidità</small>{round(now.humidity)}%</span>
              <span><small>Vento</small>{round(now.wind)} {weather.units.wind}</span>
              {weather.sunrise && weather.sunset && <span><small>{now.day ? "Tramonto" : "Alba"}</small>{now.day ? weather.sunset : weather.sunrise}</span>}
            </div>
          )}

          {cfg.hourly && weather.hours.length > 0 && (
            <div className="wx-hours" role="list" aria-label="Prossime ore">
              {weather.hours.map((h, k) => {
                // La prima colonna è "adesso": condizioni e temperatura attuali, non la previsione dell'ora piena.
                const x = describe(k === 0 ? now.code : h.code);
                const temp = k === 0 ? now.temp : h.temp;
                return (
                  <div key={k} role="listitem" className="wx-hour" style={{ animationDelay: `${Math.min(k, 12) * 35}ms` }}>
                    <span className="muted">{k === 0 ? "Ora" : h.time}</span>
                    <WeatherIcon sky={x.sky} day={k === 0 ? now.day : h.day} size={26} still />
                    <span>{round(temp)}{u}</span>
                    <span className="wx-pop">{h.pop >= 20 ? `${h.pop}%` : " "}</span>
                  </div>
                );
              })}
            </div>
          )}

          {days.length > 0 && (
            <div className="wx-days">
              {days.map((x, k) => {
                const dd = describe(x.code);
                const span = hi - lo || 1;
                return (
                  <div key={x.date} className="wx-day" style={{ animationDelay: `${k * 50}ms` }}>
                    <span className="wx-day-name">{dayName(x.date, k)}</span>
                    <span title={dd.label} style={{ display: "flex" }}><WeatherIcon sky={dd.sky} day size={24} still /></span>
                    <span className="wx-pop">{x.pop >= 20 ? `${x.pop}%` : ""}</span>
                    <span className="muted wx-num">{round(x.min)}{u}</span>
                    <span className="wx-range"><i style={{ left: `${((x.min - lo) / span) * 100}%`, width: `${Math.max(4, ((x.max - x.min) / span) * 100)}%`, animationDelay: `${150 + k * 60}ms` }} /></span>
                    <span className="wx-num">{round(x.max)}{u}</span>
                  </div>
                );
              })}
            </div>
          )}
          <a className="faint wx-credit" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Dati Open-Meteo</a>
        </>
      )}
    </div>
  );
}

function Settings({ cfg, save, pending, onDone }: { cfg: WeatherConfig; save: (c: WeatherConfig) => void; pending: boolean; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [geo, setGeo] = useState<"idle" | "busy" | "error">("idle");
  const seq = useRef(0);

  useEffect(() => {
    const v = q.trim();
    if (v.length < 2) return setResults(null);
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await findPlaces(v);
      if (n === seq.current) setResults(r);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (place: Place) => {
    save({ ...cfg, place });
    setQ("");
    setResults(null);
    onDone();
  };
  const locate = () => {
    if (!navigator.geolocation) return setGeo("error");
    setGeo("busy");
    navigator.geolocation.getCurrentPosition(
      (p) => { setGeo("idle"); pick({ name: "La mia posizione", detail: `${p.coords.latitude.toFixed(3)}, ${p.coords.longitude.toFixed(3)}`, lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => setGeo("error"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  };
  const seg = <T extends string | number>(value: T, options: [T, string][], set: (v: T) => void) => (
    <div className="seg-sb">
      {options.map(([v, label]) => <button key={String(v)} aria-pressed={value === v} onClick={() => set(v)} style={{ height: 30, padding: "0 10px", fontSize: 12 }}>{label}</button>)}
    </div>
  );
  const toggle = (key: "hourly" | "details" | "animate", label: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
      <input type="checkbox" checked={cfg[key]} onChange={(e) => save({ ...cfg, [key]: e.target.checked })} />{label}
    </label>
  );

  return (
    <div className="wx-settings">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>Luogo{cfg.place && <> · <span style={{ color: "var(--color-text)" }}>{cfg.place.name}</span>{cfg.place.detail && <span className="faint"> ({cfg.place.detail})</span>}</>}</span>
        <div style={{ position: "relative" }}>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca una città…" aria-label="Cerca una città" autoFocus={!cfg.place} style={{ width: "100%" }} />
          {results && (
            <div className="wx-results">
              {results.length ? results.map((p) => (
                <button key={`${p.lat},${p.lon}`} onClick={() => pick(p)}>
                  <span>{p.name}</span>
                  {p.detail && <span className="muted" style={{ fontSize: 12 }}>{p.detail}</span>}
                </button>
              )) : <div className="muted" style={{ padding: "10px 12px", fontSize: 13 }}>Nessun luogo trovato.</div>}
            </div>
          )}
        </div>
        <button className="btn btn-ghost" onClick={locate} disabled={geo === "busy"} style={{ alignSelf: "flex-start", gap: 6, height: 30, color: geo === "error" ? "var(--danger)" : "var(--accent-text)" }}>
          <Icon name="pin" size={14} />{geo === "busy" ? "Cerco la posizione…" : geo === "error" ? "Posizione non disponibile" : "Usa la mia posizione"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>Unità</span>
          {seg(cfg.units, [["c", "°C · km/h"], ["f", "°F · mph"]], (units) => save({ ...cfg, units }))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>Giorni di previsione</span>
          {seg(cfg.days, [[3, "3"], [5, "5"], [7, "7"]], (days) => save({ ...cfg, days }))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {toggle("hourly", "Prossime ore")}
        {toggle("details", "Dettagli")}
        {toggle("animate", "Animazioni")}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
        {pending && <span className="faint" style={{ fontSize: 12 }}>Salvo…</span>}
        <button className="btn btn-primary" onClick={onDone} disabled={!cfg.place} style={{ height: 32 }}>Fatto</button>
      </div>
    </div>
  );
}
