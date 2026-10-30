import 'server-only';
import { lookupTimezone } from '../providers/openmeteo';
import type { Location } from '../types';
import { cached } from './cache';
import { BASE, getJson } from './http';

/** Accepts "51.5072, -0.1276", "51.5072 -0.1276", "51°30'N 0°7'W". */
export function parseCoordinates(q: string): { latitude: number; longitude: number } | null {
  const s = q.trim();
  const dec = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (dec) {
    const latitude = Number(dec[1]);
    const longitude = Number(dec[2]);
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude };
    return null;
  }
  const dms = /(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])/gi;
  const parts = [...s.matchAll(dms)];
  if (parts.length === 2) {
    const val = (m: RegExpMatchArray) => {
      const v = Number(m[1]) + Number(m[2] ?? 0) / 60 + Number(m[3] ?? 0) / 3600;
      return /[SW]/i.test(m[4]) ? -v : v;
    };
    const a = parts.find((m) => /[NS]/i.test(m[4]));
    const b = parts.find((m) => /[EW]/i.test(m[4]));
    if (a && b) return { latitude: val(a), longitude: val(b) };
  }
  return null;
}

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone?: string;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
}

export async function searchLocations(q: string): Promise<Location[]> {
  const coords = parseCoordinates(q);
  if (coords) {
    const { timezone, elevation } = await cached(`tz:${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)}`, 30 * 86400, () => lookupTimezone(coords.latitude, coords.longitude)).catch(() => ({ timezone: 'UTC', elevation: undefined }));
    return [
      {
        name: `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`,
        region: 'Coordinates',
        latitude: coords.latitude,
        longitude: coords.longitude,
        timezone,
        elevation,
      },
    ];
  }
  if (q.trim().length < 2) return [];
  const params = new URLSearchParams({ name: q.trim(), count: '10', language: 'en', format: 'json' });
  const res = await cached(`geo:${q.trim().toLowerCase()}`, 7 * 86400, () => getJson<{ results?: GeoResult[] }>(`${BASE.openMeteoGeo}/v1/search?${params}`));
  return (res.results ?? []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    country: r.country,
    countryCode: r.country_code,
    latitude: r.latitude,
    longitude: r.longitude,
    elevation: r.elevation,
    timezone: r.timezone,
  }));
}

/** Read a location from query parameters (lat, lon, name, tz, cc, elev). */
export async function locationFromParams(sp: URLSearchParams): Promise<Location> {
  const latitude = Number(sp.get('lat'));
  const longitude = Number(sp.get('lon'));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Valid lat and lon query parameters are required.');
  }
  let timezone = sp.get('tz') || undefined;
  let elevation = sp.get('elev') ? Number(sp.get('elev')) : undefined;
  if (!timezone) {
    try {
      const r = await cached(`tz:${latitude.toFixed(3)},${longitude.toFixed(3)}`, 30 * 86400, () => lookupTimezone(latitude, longitude));
      timezone = r.timezone;
      elevation ??= r.elevation;
    } catch {
      timezone = 'UTC';
    }
  }
  return {
    name: sp.get('name') || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
    latitude,
    longitude,
    timezone,
    countryCode: sp.get('cc') || undefined,
    elevation: Number.isFinite(elevation) ? elevation : undefined,
  };
}
