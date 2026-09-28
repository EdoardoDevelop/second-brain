/** Meteo della Home (condiviso server/client): configurazione in `settings.weather` e codici WMO di Open-Meteo. */

export type Place = { name: string; detail: string; lat: number; lon: number };
export type WeatherConfig = {
  place: Place | null;
  units: "c" | "f";
  days: 3 | 5 | 7;
  hourly: boolean;
  details: boolean;
  animate: boolean;
};

export const DEFAULT_WEATHER: WeatherConfig = { place: null, units: "c", days: 5, hourly: true, details: true, animate: true };

export function parseWeatherConfig(raw: string | null | undefined): WeatherConfig {
  let v: Partial<WeatherConfig> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { /* predefinita */ }
  const p = v.place;
  const place = p && typeof p.name === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon)
    ? { name: p.name.slice(0, 80), detail: String(p.detail ?? "").slice(0, 120), lat: Math.max(-90, Math.min(90, p.lat)), lon: Math.max(-180, Math.min(180, p.lon)) }
    : null;
  return {
    place,
    units: v.units === "f" ? "f" : "c",
    days: v.days === 3 || v.days === 7 ? v.days : 5,
    hourly: v.hourly !== false,
    details: v.details !== false,
    animate: v.animate !== false,
  };
}

/** Famiglia di condizioni: decide l'icona animata e lo sfondo del riquadro. */
export type Sky = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

const CODES: Record<number, [string, Sky]> = {
  0: ["Sereno", "clear"],
  1: ["Prevalentemente sereno", "clear"],
  2: ["Parzialmente nuvoloso", "partly"],
  3: ["Coperto", "cloudy"],
  45: ["Nebbia", "fog"],
  48: ["Nebbia con brina", "fog"],
  51: ["Pioggerella debole", "drizzle"],
  53: ["Pioggerella", "drizzle"],
  55: ["Pioggerella intensa", "drizzle"],
  56: ["Pioggerella gelata", "drizzle"],
  57: ["Pioggerella gelata intensa", "drizzle"],
  61: ["Pioggia debole", "rain"],
  63: ["Pioggia", "rain"],
  65: ["Pioggia forte", "rain"],
  66: ["Pioggia gelata", "rain"],
  67: ["Pioggia gelata forte", "rain"],
  71: ["Neve debole", "snow"],
  73: ["Neve", "snow"],
  75: ["Neve forte", "snow"],
  77: ["Granuli di neve", "snow"],
  80: ["Rovesci deboli", "rain"],
  81: ["Rovesci", "rain"],
  82: ["Rovesci violenti", "rain"],
  85: ["Rovesci di neve", "snow"],
  86: ["Forti rovesci di neve", "snow"],
  95: ["Temporale", "storm"],
  96: ["Temporale con grandine", "storm"],
  99: ["Temporale con forte grandine", "storm"],
};

export function describe(code: number): { label: string; sky: Sky } {
  const [label, sky] = CODES[code] ?? ["—", "cloudy"];
  return { label, sky };
}

export type Weather = {
  now: { temp: number; feels: number; code: number; day: boolean; humidity: number; wind: number; precip: number; time: string };
  hours: { time: string; temp: number; code: number; day: boolean; pop: number }[];
  days: { date: string; code: number; max: number; min: number; pop: number }[];
  sunrise: string | null;
  sunset: string | null;
  units: { temp: string; wind: string };
};
