import 'server-only';
import { enrichDataset } from '../calc';
import { BASE, getJson } from '../server/http';
import { localDate } from '../time';
import type { CurrentConditions, Location, Series, WeatherDataset } from '../types';
import { fToC, inHgToHpa, inToMm, knToKmh, mmHgToHpa, mphToKmh, msToKmh } from '../units';
import type { Provider } from './types';

/**
 * Samer's home weather station, read from the CampbellON cloud API
 * (https://campbellon.com/docs/, OpenAPI at /openapi/v1/openapi.json).
 *
 * Every request needs a bearer token, obtained from POST /api/v1/tokens with
 * either a service account (client_credentials grant, preferred) or a user's
 * username + password (password grant, unavailable when the org enforces SSO).
 *
 * Configuration (all server-side env vars, never committed):
 *   CAMPBELLON_ORG_ID, CAMPBELLON_STATION_ID          required
 *   CAMPBELLON_CLIENT_ID + CAMPBELLON_CLIENT_SECRET   service account, or
 *   CAMPBELLON_USERNAME + CAMPBELLON_PASSWORD         user sign-in
 *   CAMPBELLON_BASE                                   API host (default https://campbellon.com)
 *   CAMPBELLON_STATION_LAT / _LON                     optional; limits the source to locations within 25 km
 *
 * Everything here is a measurement from one physical station, so the dataset
 * kind is 'observation'. Datastreams we can't map to a known variable, or whose
 * unit we don't recognise, are left out and listed in the dataset notes rather
 * than guessed at.
 */

export const PROVIDER_ID = 'home-station';
const PROVIDER_NAME = 'Home weather station';
const NEARBY_KM = 25;

/* ---------------- config ---------------- */

interface Config {
  base: string;
  orgId: string;
  stationId: string;
  auth: { grant_type: 'client_credentials'; client_id: string; client_secret: string } | { grant_type: 'password'; client_id: 'cloud'; username: string; password: string };
  lat: number | null;
  lon: number | null;
}

export function readConfig(env: Record<string, string | undefined> = process.env): Config | null {
  const orgId = env.CAMPBELLON_ORG_ID?.trim();
  const stationId = env.CAMPBELLON_STATION_ID?.trim();
  if (!orgId || !stationId) return null;
  let auth: Config['auth'];
  if (env.CAMPBELLON_CLIENT_ID && env.CAMPBELLON_CLIENT_SECRET) {
    auth = { grant_type: 'client_credentials', client_id: env.CAMPBELLON_CLIENT_ID, client_secret: env.CAMPBELLON_CLIENT_SECRET };
  } else if (env.CAMPBELLON_USERNAME && env.CAMPBELLON_PASSWORD) {
    auth = { grant_type: 'password', client_id: 'cloud', username: env.CAMPBELLON_USERNAME, password: env.CAMPBELLON_PASSWORD };
  } else return null;
  const lat = env.CAMPBELLON_STATION_LAT ? Number(env.CAMPBELLON_STATION_LAT) : null;
  const lon = env.CAMPBELLON_STATION_LON ? Number(env.CAMPBELLON_STATION_LON) : null;
  const ok = (x: number | null) => x !== null && Number.isFinite(x);
  return { base: (env.CAMPBELLON_BASE || BASE.campbellon).replace(/\/$/, ''), orgId, stationId, auth, lat: ok(lat) && ok(lon) ? lat : null, lon: ok(lat) && ok(lon) ? lon : null };
}

/* ---------------- field + unit mapping ---------------- */

type Agg = 'avg' | 'max' | 'sum';

interface FieldRule {
  variable: string;
  /** Tested against the lower-cased datastream field name. */
  match: RegExp;
  exclude?: RegExp;
  agg: Agg;
}

/**
 * Campbell Scientific loggers use conventional field names (AirTemp_C, AirTC_Avg,
 * RH, WS_ms_Avg, WindDir, BP_mbar, Rain_mm_Tot, SlrW_Avg…). Rules are tried in
 * order; the first stream that matches a variable wins.
 */
const NOT_STATS = /(_min|_max|_std|_tmn|_tmx|_s_wvt|_sd)\b|panel|ptemp|batt|soil|logger|enclos|ref/;
export const FIELD_RULES: FieldRule[] = [
  { variable: 'wind_gusts', match: /(ws|wind ?speed|windspd|wspd).*(_max)\b|gust/, agg: 'max' },
  { variable: 'temperature', match: /^(air_?t(emp)?|airtc|temp|t_?air|ta)(_?(c|f|degc|degf))?(_avg)?$|airtemp|airtc/, exclude: NOT_STATS, agg: 'avg' },
  { variable: 'relative_humidity', match: /^(rh|relhum|relative_?humidity|humidity)(_?(pct|percent))?(_avg)?$/, exclude: NOT_STATS, agg: 'avg' },
  { variable: 'dew_point', match: /dew_?p(oin)?t|^td(_avg)?$/, exclude: NOT_STATS, agg: 'avg' },
  { variable: 'wind_direction', match: /wind_?dir|^wd(_|$)|_d1_wvt$|^dir(_avg)?$/, agg: 'avg' },
  { variable: 'wind_speed', match: /^(ws|wind_?speed|windspd|wspd)(_?(ms|kph|kmh|mph|kn|knots))?(_avg|_s_wvt)?$/, agg: 'avg' },
  { variable: 'pressure_msl', match: /msl|slp|sea_?level/, exclude: NOT_STATS, agg: 'avg' },
  { variable: 'surface_pressure', match: /^(bp|baro|barometric|press(ure)?|stn_?press)/, exclude: NOT_STATS, agg: 'avg' },
  { variable: 'precipitation', match: /rain|precip/, exclude: /rate|intens|_max|_min|_24|daily|day|month|year|accum|cumul/, agg: 'sum' },
  { variable: 'shortwave_radiation', match: /^(slr_?w|solar(_?rad)?|sw_?in|srad|incoming_?sw)(_avg)?$|slrw/, exclude: /_max|_min|kj|mj|_tot/, agg: 'avg' },
  { variable: 'uv_index', match: /^uv(_?index|i)?(_avg)?$/, agg: 'avg' },
];

/** Converts a value in the datastream's unit into the variable's canonical unit, or null if we don't know how. */
export function unitConverter(variable: string, rawUnit: string | null | undefined): ((v: number) => number) | null {
  const u = (rawUnit ?? '').trim().toLowerCase().replace(/\s+/g, '').replace('º', '°');
  const id = (v: number) => v;
  switch (variable) {
    case 'temperature':
    case 'dew_point':
      if (['°c', 'c', 'degc', 'deg c', 'celsius'].includes(u)) return id;
      if (['°f', 'f', 'degf', 'fahrenheit'].includes(u)) return fToC;
      return null;
    case 'relative_humidity':
      return ['%', 'pct', 'percent', '%rh'].includes(u) ? id : null;
    case 'wind_speed':
    case 'wind_gusts':
      if (['m/s', 'ms', 'm s-1', 'm·s⁻¹', 'meters/second', 'metres/second', 'mps'].includes(u)) return msToKmh;
      if (['km/h', 'kmh', 'kph', 'km/hr'].includes(u)) return id;
      if (['mph', 'mi/h', 'miles/hour'].includes(u)) return mphToKmh;
      if (['kn', 'kt', 'kts', 'knots', 'knot'].includes(u)) return knToKmh;
      return null;
    case 'wind_direction':
      return ['°', 'deg', 'degrees', 'degree', '°true', 'degtrue'].includes(u) ? id : null;
    case 'pressure_msl':
    case 'surface_pressure':
      if (['hpa', 'mbar', 'mb', 'millibar', 'millibars'].includes(u)) return id;
      if (u === 'kpa') return (v) => v * 10;
      if (u === 'pa') return (v) => v / 100;
      if (['inhg', 'in hg', 'inchesofmercury'].includes(u)) return inHgToHpa;
      if (u === 'mmhg') return mmHgToHpa;
      return null;
    case 'precipitation':
      if (u === 'mm') return id;
      if (['in', 'inch', 'inches'].includes(u)) return inToMm;
      return null;
    case 'shortwave_radiation':
      return ['w/m²', 'w/m2', 'w/m^2', 'wm-2', 'w m-2', 'w·m⁻²'].includes(u) ? id : null;
    case 'uv_index':
      return ['', 'index', 'uvi', 'uv index'].includes(u) ? id : null;
  }
  return null;
}

export interface StreamInfo {
  id: string;
  field: string;
  table?: string;
  unit: string | null;
}

export interface MappedStream extends StreamInfo {
  variable: string;
  agg: Agg;
  convert: (v: number) => number;
}

/** Picks one datastream per variable and reports the ones left out. */
export function mapStreams(streams: StreamInfo[]): { mapped: MappedStream[]; skipped: string[] } {
  const mapped: MappedStream[] = [];
  const used = new Set<string>();
  const skipped: string[] = [];
  for (const rule of FIELD_RULES) {
    if (mapped.some((m) => m.variable === rule.variable)) continue;
    for (const s of streams) {
      if (used.has(s.id)) continue;
      const f = s.field.toLowerCase();
      if (!rule.match.test(f) || rule.exclude?.test(f)) continue;
      const convert = unitConverter(rule.variable, s.unit);
      if (!convert) {
        skipped.push(`${s.field} (unrecognised unit "${s.unit ?? ''}" for ${rule.variable})`);
        used.add(s.id);
        continue;
      }
      mapped.push({ ...s, variable: rule.variable, agg: rule.agg, convert });
      used.add(s.id);
      break;
    }
  }
  for (const s of streams) if (!used.has(s.id)) skipped.push(s.field);
  return { mapped, skipped };
}

/* ---------------- API ---------------- */

interface TokenResponse {
  access_token: string;
  expires_in?: number;
}
interface DatastreamItem {
  id: string;
  metadata?: { field?: string; table?: string; uom?: string; status?: string; station_id?: string };
}
export interface LatestResponse {
  data: Record<string, { ts: string; value: number | null; field_name: string; table_name?: string; unit?: string | null }>;
}
export interface DatapointsResponse {
  meta?: { resolution?: string; truncated?: boolean };
  datastreams?: Record<string, { field_name: string; table_name?: string; unit?: string | null }>;
  data: { ts: string; v: Record<string, number | null> }[];
}

let token: { value: string; expires: number; key: string } | null = null;

async function getToken(cfg: Config): Promise<string> {
  const key = `${cfg.base}|${cfg.auth.client_id}|${'username' in cfg.auth ? cfg.auth.username : ''}`;
  if (token && token.key === key && token.expires > Date.now() + 60_000) return token.value;
  const res = await getJson<TokenResponse>(`${cfg.base}/api/v1/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg.auth),
  }).catch((e: Error & { status?: number }) => {
    if (e.status === 401 || e.status === 400 || e.status === 403) throw new Error('CampbellON rejected the sign-in. Check the CAMPBELLON_* credentials on the server.');
    throw e;
  });
  if (!res?.access_token) throw new Error('CampbellON did not return an access token.');
  token = { value: res.access_token, expires: Date.now() + (res.expires_in ?? 300) * 1000, key };
  return token.value;
}

/** Test hook: forget the cached token. */
export function _resetToken() {
  token = null;
}

async function api<T>(cfg: Config, path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const t = await getToken(cfg);
  return getJson<T>(`${cfg.base}${path}${qs}`, { headers: { Authorization: `Bearer ${t}` }, timeoutMs: 20000 });
}

async function stationStreams(cfg: Config): Promise<StreamInfo[]> {
  const list = await api<DatastreamItem[]>(cfg, `/api/v1/organizations/${cfg.orgId}/datastreams`, { stationId: cfg.stationId, limit: '500' });
  return (Array.isArray(list) ? list : [])
    .filter((d) => d.metadata?.field && d.metadata?.status !== 'inactive')
    .map((d) => ({ id: d.id, field: d.metadata!.field!, table: d.metadata?.table, unit: d.metadata?.uom ?? null }));
}

/* ---------------- parsing (pure, tested) ---------------- */

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const hourOf = (iso: string) => Math.floor(Date.parse(iso) / 3600_000) * 3600_000;
const isoHour = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Latest reading per variable. Readings older than `maxAgeH` are dropped, never shown as current. */
export function parseLatest(res: LatestResponse, now = Date.now(), maxAgeH = 3): CurrentConditions | null {
  const streams: StreamInfo[] = Object.entries(res.data ?? {}).map(([id, d]) => ({ id, field: d.field_name, table: d.table_name, unit: d.unit ?? null }));
  // Rain is logged as per-interval totals, which aren't meaningful as a "current" value.
  const mapped = mapStreams(streams).mapped.filter((m) => m.agg !== 'sum');
  const values: Record<string, number | null> = {};
  let newest = 0;
  for (const m of mapped) {
    const d = res.data[m.id];
    const t = Date.parse(d.ts);
    if (!finite(d.value) || !Number.isFinite(t) || now - t > maxAgeH * 3600_000) continue;
    values[m.variable] = m.convert(d.value);
    newest = Math.max(newest, t);
  }
  if (!newest) return null;
  return {
    time: new Date(newest).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    values,
    condition: null,
    description: null,
    isDay: null,
    kind: 'observation',
    sourceNote: 'Measured by your home station (CampbellON).',
  };
}

/**
 * Merges the averaged, max and raw (summed) datapoint responses into one hourly block.
 * `start`/`end` are local calendar dates in `tz`; hours outside them are dropped.
 */
export function buildHourly(
  mapped: MappedStream[],
  parts: { avg?: DatapointsResponse; max?: DatapointsResponse; raw?: DatapointsResponse },
  tz: string,
  start: string,
  end: string,
): { time: string[]; series: Record<string, Series>; truncated: boolean } {
  const cells = new Map<number, Record<string, number>>();
  const put = (hour: number, variable: string, v: number, mode: 'set' | 'sum') => {
    const local = localDate(hour, tz);
    if (local < start || local > end) return;
    const row = cells.get(hour) ?? {};
    row[variable] = mode === 'sum' ? (row[variable] ?? 0) + v : v;
    cells.set(hour, row);
  };
  for (const [agg, res] of [['avg', parts.avg], ['max', parts.max], ['sum', parts.raw]] as const) {
    if (!res) continue;
    const streams = mapped.filter((m) => m.agg === agg);
    for (const p of res.data ?? []) {
      for (const m of streams) {
        const raw = p.v?.[m.id];
        if (!finite(raw)) continue;
        // Hourly aggregates are stamped at the start of their hour. Raw rain totals are stamped at
        // the END of their logging interval, so step back 1 s to land in the hour they fell in.
        const hour = agg === 'sum' ? hourOf(new Date(Date.parse(p.ts) - 1000).toISOString()) : hourOf(p.ts);
        put(hour, m.variable, m.convert(raw), agg === 'sum' ? 'sum' : 'set');
      }
    }
  }
  const hours = [...cells.keys()].sort((a, b) => a - b);
  const series: Record<string, Series> = {};
  for (const m of mapped) {
    const values = hours.map((h) => cells.get(h)?.[m.variable] ?? null);
    if (!values.some((x) => x !== null)) continue;
    const notes: Record<Agg, string> = {
      avg: `Hourly mean of station field ${m.field}.`,
      max: `Highest reading of station field ${m.field} in the hour.`,
      sum: `Sum of station field ${m.field} over the hour (assumes the logger records per-interval totals).`,
    };
    series[m.variable] = { values, origin: 'provider', note: notes[m.agg] };
  }
  const truncated = !!(parts.avg?.meta?.truncated || parts.max?.meta?.truncated || parts.raw?.meta?.truncated);
  return { time: hours.map(isoHour), series, truncated };
}

/* ---------------- provider ---------------- */

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const ATTRIBUTION = { text: 'Your own station, via CampbellON', url: 'https://campbellon.com/' };

export async function homeStationLatest(): Promise<CurrentConditions | null> {
  const cfg = readConfig();
  if (!cfg) return null;
  const res = await api<LatestResponse>(cfg, `/api/v1/data/organizations/${cfg.orgId}/stations/${cfg.stationId}/datapoints/latest`, { limit: '50', order: 'newest' });
  return parseLatest(res);
}

export const homeStation: Provider = {
  id: PROVIDER_ID,
  name: PROVIDER_NAME,
  shortName: 'Home station',
  organisation: 'Your station (CampbellON)',
  kind: 'observation',
  description: 'Measurements from your own Campbell Scientific weather station, read from the CampbellON cloud. Optional: needs your CampbellON organisation ID, station ID and sign-in.',
  coverage: 'Your station only',
  access:
    'Needs CAMPBELLON_ORG_ID, CAMPBELLON_STATION_ID and either a service account (CAMPBELLON_CLIENT_ID + CAMPBELLON_CLIENT_SECRET) or CAMPBELLON_USERNAME + CAMPBELLON_PASSWORD on the server. Some endpoints depend on your CampbellON subscription plan.',
  requiresKey: true,
  enabled: !!readConfig(),
  url: 'https://campbellon.com/docs/',
  color: '#16a34a',
  supportsForecast: false,
  historyRange: { from: 'P366D', toDaysAgo: 0, resolutions: ['hourly', 'daily'], kind: 'observation' },
  covers(loc: Location) {
    const cfg = readConfig();
    if (!cfg) return false;
    if (cfg.lat === null || cfg.lon === null) return true;
    return distanceKm(cfg.lat, cfg.lon, loc.latitude, loc.longitude) <= NEARBY_KM;
  },
  async history(loc, start, end) {
    const cfg = readConfig();
    if (!cfg) throw new Error(homeStation.access);
    const tz = loc.timezone || 'UTC';
    const all = await stationStreams(cfg);
    const { mapped, skipped } = mapStreams(all);
    if (!mapped.length) throw new Error(`None of the station's datastreams could be matched to a weather variable (${all.map((s) => s.field).join(', ') || 'no datastreams found'}).`);
    // Pad by a day on each side: the API works in UTC, the requested range is in local dates.
    const range = {
      start: new Date(Date.parse(`${start}T00:00:00Z`) - 86400_000).toISOString(),
      end: new Date(Date.parse(`${end}T00:00:00Z`) + 2 * 86400_000).toISOString(),
    };
    const path = `/api/v1/data/organizations/${cfg.orgId}/datapoints`;
    const ids = (agg: Agg) => mapped.filter((m) => m.agg === agg).map((m) => m.id).join(',');
    const req = (agg: Agg, extra: Record<string, string>) =>
      ids(agg) ? api<DatapointsResponse>(cfg, path, { datastream_ids: ids(agg), ...range, limit: '50000', ...extra }) : Promise.resolve(undefined);
    const [avg, max, raw] = await Promise.all([
      req('avg', { resolution: 'hourly', aggregation: 'avg' }),
      req('max', { resolution: 'hourly', aggregation: 'max' }),
      req('sum', { resolution: 'raw' }),
    ]);
    const hourly = buildHourly(mapped, { avg, max, raw }, tz, start, end);
    const notes = [
      'Measured by your home station. Hours with no readings are left empty.',
      `Station fields used: ${mapped.map((m) => `${m.field} → ${m.variable}`).join(', ')}.`,
    ];
    if (skipped.length) notes.push(`Not shown (no matching variable or unit): ${skipped.join(', ')}.`);
    if (hourly.truncated) notes.push('CampbellON truncated this response; pick a shorter range for complete data.');
    if (cfg.lat === null) notes.push('Station location is not configured (CAMPBELLON_STATION_LAT/LON), so this source is offered for every location even though it only measures at home.');
    const ds: WeatherDataset = {
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      kind: 'observation',
      location: { ...loc, timezone: tz },
      timezone: tz,
      fetchedAt: new Date().toISOString(),
      updatedAt: hourly.time.length ? hourly.time[hourly.time.length - 1] : null,
      hourly: { time: hourly.time, series: hourly.series },
      notes,
      attribution: ATTRIBUTION,
    };
    return enrichDataset(ds, 16);
  },
};
