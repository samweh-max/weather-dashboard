import 'server-only';

export const USER_AGENT =
  process.env.WEATHER_APP_CONTACT || 'weather-dashboard/0.1 (https://github.com/samweh-max/weather-dashboard)';

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** fetch JSON with a timeout and a readable error message. */
export async function getJson<T = unknown>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 15000, headers, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/geo+json', ...(headers ?? {}) },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.text();
        const j = JSON.parse(body);
        detail = j.reason || j.detail || j.title || j.message || body.slice(0, 200);
      } catch {
        /* ignore */
      }
      throw new HttpError(`${new URL(url).host} responded ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
    }
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`${new URL(url).host} timed out after ${timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Base URLs, overridable for testing against a local mock server. */
export const BASE = {
  openMeteo: process.env.OPEN_METEO_BASE || 'https://api.open-meteo.com',
  openMeteoArchive: process.env.OPEN_METEO_ARCHIVE_BASE || 'https://archive-api.open-meteo.com',
  openMeteoAir: process.env.OPEN_METEO_AIR_BASE || 'https://air-quality-api.open-meteo.com',
  openMeteoMarine: process.env.OPEN_METEO_MARINE_BASE || 'https://marine-api.open-meteo.com',
  openMeteoGeo: process.env.OPEN_METEO_GEO_BASE || 'https://geocoding-api.open-meteo.com',
  nws: process.env.NWS_BASE || 'https://api.weather.gov',
  metno: process.env.METNO_BASE || 'https://api.met.no',
  metOffice: process.env.MET_OFFICE_BASE || 'https://data.hub.api.metoffice.gov.uk',
};
