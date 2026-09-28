import "server-only";
import type { Place, Weather, WeatherConfig } from "./weather";

/** Dati da Open-Meteo (gratuito, senza chiave, licenza CC BY 4.0). Cache in memoria di 15 minuti per luogo e unità. */
const TTL = 15 * 60_000;
const cache = new Map<string, { at: number; data: Weather }>();

type Raw = {
  current: { time: string; temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; is_day: number; weather_code: number; wind_speed_10m: number; precipitation: number };
  current_units: { temperature_2m: string; wind_speed_10m: string };
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; is_day: number[]; precipitation_probability: (number | null)[] };
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[]; sunrise: string[]; sunset: string[] };
};

export async function getWeather(cfg: WeatherConfig): Promise<Weather | null> {
  if (!cfg.place) return null;
  const { lat, lon } = cfg.place;
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${cfg.units}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m,precipitation",
    hourly: "temperature_2m,weather_code,is_day,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    timezone: "auto",
    forecast_days: "7",
    temperature_unit: cfg.units === "f" ? "fahrenheit" : "celsius",
    wind_speed_unit: cfg.units === "f" ? "mph" : "kmh",
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const r = (await res.json()) as Raw;
    const c = r.current;
    // Le prossime 24 ore a partire dall'ora corrente (orari locali del luogo).
    const hourStart = c.time.slice(0, 13);
    const from = Math.max(0, r.hourly.time.findIndex((t) => t.slice(0, 13) >= hourStart));
    const data: Weather = {
      now: { temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, day: c.is_day === 1, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, precip: c.precipitation, time: c.time },
      hours: r.hourly.time.slice(from, from + 24).map((t, k) => ({
        time: t.slice(11, 16),
        temp: r.hourly.temperature_2m[from + k],
        code: r.hourly.weather_code[from + k],
        day: r.hourly.is_day[from + k] === 1,
        pop: r.hourly.precipitation_probability[from + k] ?? 0,
      })),
      days: r.daily.time.map((d, k) => ({
        date: d,
        code: r.daily.weather_code[k],
        max: r.daily.temperature_2m_max[k],
        min: r.daily.temperature_2m_min[k],
        pop: r.daily.precipitation_probability_max[k] ?? 0,
      })),
      sunrise: r.daily.sunrise[0]?.slice(11, 16) ?? null,
      sunset: r.daily.sunset[0]?.slice(11, 16) ?? null,
      units: { temp: cfg.units === "f" ? "°F" : "°", wind: r.current_units.wind_speed_10m.replace("mp/h", "mph") },
    };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.error("[meteo]", e);
    return hit?.data ?? null;
  }
}

/** Ricerca dei luoghi per nome (in italiano). */
export async function searchPlaces(name: string): Promise<Place[]> {
  const q = new URLSearchParams({ name: name.trim().slice(0, 80), count: "6", language: "it", format: "json" });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!res.ok) return [];
  const j = (await res.json()) as { results?: { name: string; latitude: number; longitude: number; admin1?: string; admin2?: string; country?: string }[] };
  return (j.results ?? []).map((p) => ({
    name: p.name,
    detail: [p.admin2?.replace(/^Provincia (di |della |dell'|del )?/i, ""), p.admin1, p.country].filter((x, i, a) => x && a.indexOf(x) === i && x !== p.name).join(", "),
    lat: p.latitude,
    lon: p.longitude,
  }));
}
