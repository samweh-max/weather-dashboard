import 'server-only';
import { enrichDataset } from '../calc';
import { textToCondition } from '../conditions';
import { BASE, getJson } from '../server/http';
import { cached } from '../server/cache';
import { localDate, toIsoUtc } from '../time';
import type { Condition, CurrentConditions, Location, Series, TimeBlock, WeatherDataset } from '../types';
import type { Provider } from './types';

/**
 * NOAA National Weather Service API (api.weather.gov). Free, keyless, US territory only.
 * NWS asks for a User-Agent identifying the app; no published hard rate limit but
 * "reasonable" use is expected, so responses are cached.
 */

const ATTRIBUTION = { text: 'NOAA National Weather Service (public domain)', url: 'https://www.weather.gov/documentation/services-web-api' };

interface PointsResponse {
  properties: {
    forecastHourly: string;
    forecastGridData: string;
    observationStations: string;
    timeZone: string;
    relativeLocation?: { properties?: { city?: string; state?: string } };
  };
}

interface GridValue {
  validTime: string;
  value: number | null;
}
interface GridLayer {
  uom?: string;
  values: GridValue[];
}
interface GridResponse {
  properties: Record<string, GridLayer | unknown> & { updateTime?: string };
}
interface HourlyPeriod {
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  shortForecast: string;
  temperature: number;
  temperatureUnit: string;
}
interface HourlyForecast {
  properties: { updateTime?: string; generatedAt?: string; periods: HourlyPeriod[] };
}
interface QV {
  value: number | null;
  unitCode?: string;
  qualityControl?: string;
}
interface Observation {
  properties: {
    timestamp: string;
    textDescription?: string;
    temperature?: QV;
    dewpoint?: QV;
    windDirection?: QV;
    windSpeed?: QV;
    windGust?: QV;
    barometricPressure?: QV;
    seaLevelPressure?: QV;
    visibility?: QV;
    relativeHumidity?: QV;
    windChill?: QV;
    heatIndex?: QV;
    precipitationLastHour?: QV;
  };
}

/** Convert an NWS/WMO unit-coded value into our canonical unit. */
export function nwsToCanonical(value: number | null | undefined, unit: string | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const u = (unit ?? '').replace(/^wmoUnit:|^unit:/, '');
  switch (u) {
    case 'degF':
      return ((value - 32) * 5) / 9;
    case 'K':
      return value - 273.15;
    case 'm_s-1':
      return value * 3.6;
    case 'km_h-1':
      return value;
    case 'kt':
      return value * 1.852;
    case 'Pa':
      return value / 100;
    case 'hPa':
      return value;
    case 'inHg':
      return value * 33.8638866667;
    case 'm':
      return value; // caller decides (visibility → km, precip → mm)
    case 'mm':
      return value;
    default:
      return value;
  }
}

/** Parse "2026-10-30T20:00:00+00:00/PT3H" → [startMs, hours]. */
export function parseValidTime(validTime: string): [number, number] {
  const [start, dur] = validTime.split('/');
  const t = Date.parse(start);
  const m = dur?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
  const hours = m ? Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0) + Math.ceil(Number(m[3] ?? 0) / 60) : 1;
  return [t, Math.max(1, hours)];
}

/**
 * Expand a gridpoint layer to an hourly series aligned to `times` (ISO UTC hours).
 * Accumulations (precipitation, snowfall) are spread evenly across their period.
 */
export function expandLayer(layer: GridLayer | undefined, times: string[], opts: { accumulate?: boolean; scale?: number } = {}): (number | null)[] {
  const out: (number | null)[] = times.map(() => null);
  if (!layer?.values?.length) return out;
  const index = new Map(times.map((t, i) => [t, i]));
  for (const { validTime, value } of layer.values) {
    if (value === null || value === undefined) continue;
    const [start, hours] = parseValidTime(validTime);
    let v = nwsToCanonical(value, layer.uom);
    if (v === null) continue;
    if (opts.scale) v *= opts.scale;
    const per = opts.accumulate ? v / hours : v;
    for (let h = 0; h < hours; h++) {
      const i = index.get(toIsoUtc(start + h * 3600_000));
      if (i !== undefined) out[i] = per;
    }
  }
  return out;
}

async function points(loc: Location) {
  const key = `nws:points:${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`;
  return cached(key, 7 * 86400, () => getJson<PointsResponse>(`${BASE.nws}/points/${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`));
}

async function nearestStation(loc: Location): Promise<{ id: string; name: string } | null> {
  const p = await points(loc);
  const key = `nws:stations:${p.properties.observationStations}`;
  const st = await cached(key, 7 * 86400, () =>
    getJson<{ features: { properties: { stationIdentifier: string; name: string } }[] }>(p.properties.observationStations),
  );
  const f = st.features?.[0];
  return f ? { id: f.properties.stationIdentifier, name: f.properties.name } : null;
}

function obsValues(o: Observation['properties']): Record<string, number | null> {
  const vis = nwsToCanonical(o.visibility?.value, o.visibility?.unitCode);
  return {
    temperature: nwsToCanonical(o.temperature?.value, o.temperature?.unitCode),
    dew_point: nwsToCanonical(o.dewpoint?.value, o.dewpoint?.unitCode),
    relative_humidity: o.relativeHumidity?.value ?? null,
    wind_speed: nwsToCanonical(o.windSpeed?.value, o.windSpeed?.unitCode),
    wind_gusts: nwsToCanonical(o.windGust?.value, o.windGust?.unitCode),
    wind_direction: o.windDirection?.value ?? null,
    pressure_msl: nwsToCanonical(o.seaLevelPressure?.value ?? o.barometricPressure?.value, o.seaLevelPressure?.unitCode ?? o.barometricPressure?.unitCode),
    surface_pressure: nwsToCanonical(o.barometricPressure?.value, o.barometricPressure?.unitCode),
    visibility: vis === null ? null : vis / 1000,
    wind_chill: nwsToCanonical(o.windChill?.value, o.windChill?.unitCode),
    heat_index: nwsToCanonical(o.heatIndex?.value, o.heatIndex?.unitCode),
    precipitation: nwsToCanonical(o.precipitationLastHour?.value, o.precipitationLastHour?.unitCode),
  };
}

export const isInUS = (loc: Location) => {
  if (loc.countryCode) return ['US', 'PR', 'GU', 'VI', 'AS', 'MP'].includes(loc.countryCode.toUpperCase());
  const { latitude: la, longitude: lo } = loc;
  return (la > 24 && la < 50 && lo > -125 && lo < -66) || (la > 51 && la < 72 && lo > -170 && lo < -129) || (la > 18 && la < 23 && lo > -161 && lo < -154);
};

export const nwsForecast: Provider = {
  id: 'nws',
  name: 'NOAA National Weather Service',
  shortName: 'NWS',
  organisation: 'NOAA / National Weather Service (USA)',
  kind: 'forecast',
  description:
    'Official US forecasts from local NWS forecast offices (forecaster-edited National Digital Forecast Database grids), plus the latest observation from the nearest airport/ASOS station.',
  coverage: 'United States and territories only',
  access: 'Free, no key. Requires a User-Agent header (configured server-side). No fixed rate limit; responses are cached.',
  requiresKey: false,
  enabled: true,
  url: 'https://www.weather.gov/documentation/services-web-api',
  color: '#0ea5e9',
  supportsForecast: true,
  covers: isInUS,
  async forecast(loc) {
    const p = await points(loc);
    const tz = p.properties.timeZone || loc.timezone || 'UTC';
    const [grid, hourlyFc, current] = await Promise.all([
      getJson<GridResponse>(p.properties.forecastGridData),
      getJson<HourlyForecast>(p.properties.forecastHourly).catch(() => null),
      nwsLatestObservation(loc).catch(() => null),
    ]);
    const gp = grid.properties;
    const layer = (k: string) => gp[k] as GridLayer | undefined;

    // Hourly time axis from the temperature layer
    const tempLayer = layer('temperature');
    const hourSet = new Set<string>();
    for (const { validTime } of tempLayer?.values ?? []) {
      const [start, hours] = parseValidTime(validTime);
      for (let h = 0; h < hours; h++) hourSet.add(toIsoUtc(start + h * 3600_000));
    }
    const nowHour = Math.floor(Date.now() / 3600_000) * 3600_000;
    const times = [...hourSet].filter((t) => Date.parse(t) >= nowHour - 3600_000).sort();

    const s = (values: (number | null)[], note?: string): Series => ({ values, origin: 'provider', note });
    const series: Record<string, Series> = {
      temperature: s(expandLayer(tempLayer, times)),
      dew_point: s(expandLayer(layer('dewpoint'), times)),
      relative_humidity: s(expandLayer(layer('relativeHumidity'), times)),
      apparent_temperature: s(expandLayer(layer('apparentTemperature'), times)),
      heat_index: s(expandLayer(layer('heatIndex'), times)),
      wind_chill: s(expandLayer(layer('windChill'), times)),
      cloud_cover: s(expandLayer(layer('skyCover'), times)),
      wind_direction: s(expandLayer(layer('windDirection'), times)),
      wind_speed: s(expandLayer(layer('windSpeed'), times)),
      wind_gusts: s(expandLayer(layer('windGust'), times)),
      precipitation_probability: s(expandLayer(layer('probabilityOfPrecipitation'), times)),
      precipitation: s(expandLayer(layer('quantitativePrecipitation'), times, { accumulate: true }), 'NWS publishes precipitation as multi-hour totals (usually 6 h); spread evenly across those hours.'),
      snowfall: s(expandLayer(layer('snowfallAmount'), times, { accumulate: true, scale: 0.1 }), 'NWS publishes snowfall as multi-hour totals; spread evenly across those hours.'),
      visibility: s(expandLayer(layer('visibility'), times).map((x) => (x === null ? null : x / 1000))),
    };
    for (const k of Object.keys(series)) if (!series[k].values.some((x) => x !== null)) delete series[k];

    // Conditions from the hourly text forecast
    let conditions: (Condition | null)[] | undefined;
    let descriptions: (string | null)[] | undefined;
    if (hourlyFc?.properties?.periods?.length) {
      const byHour = new Map(hourlyFc.properties.periods.map((pp) => [toIsoUtc(Date.parse(pp.startTime)), pp]));
      descriptions = times.map((t) => byHour.get(t)?.shortForecast ?? null);
      conditions = descriptions.map(textToCondition);
    }
    const hourly: TimeBlock = { time: times, series, conditions, descriptions };

    // Official daily max/min periods
    const dailyMap = new Map<string, { max?: number; min?: number }>();
    const putDaily = (k: 'max' | 'min', l?: GridLayer) => {
      for (const { validTime, value } of l?.values ?? []) {
        const v = nwsToCanonical(value, l?.uom);
        if (v === null) continue;
        const [start, hours] = parseValidTime(validTime);
        const day = localDate(start + (hours / 2) * 3600_000, tz);
        const e = dailyMap.get(day) ?? {};
        e[k] = v;
        dailyMap.set(day, e);
      }
    };
    putDaily('max', layer('maxTemperature'));
    putDaily('min', layer('minTemperature'));
    const days = [...dailyMap.keys()].sort();
    const daily: TimeBlock = {
      time: days,
      series: {
        temperature_max: { values: days.map((d) => dailyMap.get(d)?.max ?? null), origin: 'provider', note: 'Official NWS daytime high.' },
        temperature_min: { values: days.map((d) => dailyMap.get(d)?.min ?? null), origin: 'provider', note: 'Official NWS overnight low (may fall on the morning of this date).' },
      },
    };

    const ds = enrichDataset({
      providerId: 'nws',
      providerName: 'NOAA National Weather Service',
      kind: 'forecast',
      location: { ...loc, timezone: loc.timezone || tz },
      timezone: tz,
      fetchedAt: new Date().toISOString(),
      updatedAt: gp.updateTime ?? hourlyFc?.properties?.updateTime ?? null,
      current: current ?? undefined,
      hourly,
      daily,
      notes: [
        'Forecast from the local NWS Weather Forecast Office grid.',
        current ? `Current conditions are a measured observation from ${current.sourceNote}.` : 'No recent station observation available.',
        'NWS does not publish UV index, pressure forecasts or solar radiation in this API.',
      ],
      attribution: ATTRIBUTION,
    });
    return ds;
  },
};

export async function nwsLatestObservation(loc: Location): Promise<CurrentConditions | null> {
  const st = await nearestStation(loc);
  if (!st) return null;
  const o = await getJson<Observation>(`${BASE.nws}/stations/${st.id}/observations/latest`);
  const pr = o.properties;
  // Ignore stale observations (> 3 h old)
  if (!pr?.timestamp || Date.now() - Date.parse(pr.timestamp) > 3 * 3600_000) return null;
  return {
    time: toIsoUtc(Date.parse(pr.timestamp)),
    values: obsValues(pr),
    condition: textToCondition(pr.textDescription),
    description: pr.textDescription || null,
    isDay: null,
    kind: 'observation',
    sourceNote: `${st.name} (${st.id})`,
  };
}

export const nwsObservations: Provider = {
  id: 'nws-obs',
  name: 'NWS station observations',
  shortName: 'NWS obs',
  organisation: 'NOAA / National Weather Service (USA)',
  kind: 'observation',
  description: 'Measured observations from the nearest NWS/FAA ASOS or AWOS station. The API keeps roughly the last 7 days.',
  coverage: 'United States, last ~7 days',
  access: 'Free, no key. Requires a User-Agent header.',
  requiresKey: false,
  enabled: true,
  url: 'https://www.weather.gov/documentation/services-web-api',
  color: '#06b6d4',
  supportsForecast: false,
  historyRange: { from: 'P7D', toDaysAgo: 0, resolutions: ['hourly', 'daily'], kind: 'observation' },
  covers: isInUS,
  async history(loc, start, end) {
    const p = await points(loc);
    const tz = p.properties.timeZone || loc.timezone || 'UTC';
    const st = await nearestStation(loc);
    if (!st) throw new Error('No NWS observation station found near this location.');
    const params = new URLSearchParams({ start: new Date(`${start}T00:00:00Z`).toISOString(), end: new Date(Date.parse(`${end}T00:00:00Z`) + 86400_000 * 1.5).toISOString(), limit: '500' });
    const res = await getJson<{ features: Observation[] }>(`${BASE.nws}/stations/${st.id}/observations?${params}`);
    // Bin observations to the nearest hour, keeping the one closest to the hour mark
    const best = new Map<string, { dist: number; values: Record<string, number | null> }>();
    for (const f of res.features ?? []) {
      const ts = Date.parse(f.properties.timestamp);
      const hour = Math.round(ts / 3600_000) * 3600_000;
      const local = localDate(hour, tz);
      if (local < start || local > end) continue;
      const key = toIsoUtc(hour);
      const dist = Math.abs(ts - hour);
      const prev = best.get(key);
      if (!prev || dist < prev.dist) best.set(key, { dist, values: obsValues(f.properties) });
    }
    const times = [...best.keys()].sort();
    const ids = ['temperature', 'dew_point', 'relative_humidity', 'wind_speed', 'wind_gusts', 'wind_direction', 'pressure_msl', 'surface_pressure', 'visibility', 'wind_chill', 'heat_index', 'precipitation'];
    const series: Record<string, Series> = {};
    for (const id of ids) {
      const values = times.map((t) => best.get(t)?.values[id] ?? null);
      if (values.some((x) => x !== null)) series[id] = { values, origin: 'provider' };
    }
    return enrichDataset(
      {
        providerId: 'nws-obs',
        providerName: 'NWS station observations',
        kind: 'observation',
        location: { ...loc, timezone: loc.timezone || tz },
        timezone: tz,
        fetchedAt: new Date().toISOString(),
        updatedAt: times.length ? times[times.length - 1] : null,
        hourly: { time: times, series },
        notes: [`Measured at ${st.name} (${st.id}). Hours without a report are left empty.`, 'Station precipitation is often missing from the NWS feed.'],
        attribution: ATTRIBUTION,
      },
      16,
    );
  },
};
