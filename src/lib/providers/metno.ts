import 'server-only';
import { addCalculatedDaily, addCalculatedHourly, aggregate, deriveDaily, groupByLocalDay } from '../calc';
import { metnoSymbolText, metnoSymbolToCondition } from '../conditions';
import { BASE, getJson } from '../server/http';
import type { Condition, CurrentConditions, Location, Series, TimeBlock, WeatherDataset } from '../types';
import type { Provider } from './types';

/**
 * MET Norway Locationforecast 2.0. Free, keyless, global (ECMWF-based with Nordic
 * high-resolution nests). Terms require an identifying User-Agent and caching;
 * more than 20 requests/second per app is throttled. Data CC BY 4.0 / NLOD.
 */

interface MetnoStep {
  time: string;
  data: {
    instant: { details: Record<string, number | undefined> };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: Record<string, number | undefined> };
    next_6_hours?: { summary?: { symbol_code?: string }; details?: Record<string, number | undefined> };
    next_12_hours?: { summary?: { symbol_code?: string }; details?: Record<string, number | undefined> };
  };
}
export interface MetnoResponse {
  properties: { meta: { updated_at: string }; timeseries: MetnoStep[] };
}

const n = (x: number | undefined) => (x === undefined || x === null || !Number.isFinite(x) ? null : x);

export function parseMetno(res: MetnoResponse, loc: Location, tz: string): WeatherDataset {
  const steps = res.properties.timeseries;
  const time = steps.map((s) => s.time.replace(/\.\d+Z$/, 'Z'));
  const pick = (f: (s: MetnoStep) => number | null): (number | null)[] => steps.map(f);
  const inst = (k: string, conv: (x: number) => number = (x) => x) => pick((s) => {
    const v = n(s.data.instant.details[k]);
    return v === null ? null : conv(v);
  });
  const hourlyStep = steps.map((s) => !!s.data.next_1_hours);

  const series: Record<string, Series> = {
    temperature: { values: inst('air_temperature'), origin: 'provider' },
    dew_point: { values: inst('dew_point_temperature'), origin: 'provider' },
    relative_humidity: { values: inst('relative_humidity'), origin: 'provider' },
    pressure_msl: { values: inst('air_pressure_at_sea_level'), origin: 'provider' },
    cloud_cover: { values: inst('cloud_area_fraction'), origin: 'provider' },
    wind_speed: { values: inst('wind_speed', (x) => x * 3.6), origin: 'provider' },
    wind_gusts: { values: inst('wind_speed_of_gust', (x) => x * 3.6), origin: 'provider' },
    wind_direction: { values: inst('wind_from_direction'), origin: 'provider' },
    uv_index: { values: inst('ultraviolet_index_clear_sky'), origin: 'provider', note: 'MET Norway publishes clear-sky UV index (the value if there were no clouds).' },
    precipitation: {
      values: pick((s) => n(s.data.next_1_hours?.details?.precipitation_amount)),
      origin: 'provider',
      note: 'Hourly amounts for roughly the first 2–3 days; later steps are 6-hourly and not shown hourly.',
    },
    precipitation_probability: { values: pick((s) => n(s.data.next_1_hours?.details?.probability_of_precipitation)), origin: 'provider' },
  };
  for (const k of Object.keys(series)) if (!series[k].values.some((x) => x !== null)) delete series[k];

  const symbols = steps.map((s) => s.data.next_1_hours?.summary?.symbol_code ?? s.data.next_6_hours?.summary?.symbol_code ?? null);
  const conditions: (Condition | null)[] = symbols.map(metnoSymbolToCondition);
  const descriptions = symbols.map(metnoSymbolText);
  let hourly: TimeBlock = { time, series, conditions, descriptions };
  hourly = addCalculatedHourly(hourly);

  // Daily: from hourly where the day is fully hourly; otherwise from the 6-hourly steps
  // (max/min of 4 instants, precipitation from next_6_hours totals).
  let daily = deriveDaily(hourly, tz, undefined, 20);
  const groups = groupByLocalDay(time, tz);
  const t6 = daily.time.map((day) => {
    const idx = groups.get(day) ?? [];
    const sixHourly = idx.filter((i) => !hourlyStep[i]);
    return { idx, sixHourly };
  });
  const fill = (id: string, compute: (idx: number[], six: number[]) => number | null, note: string) => {
    const s = daily.series[id] ?? { values: daily.time.map(() => null), origin: 'calculated' as const, note };
    const values = s.values.map((v, d) => {
      if (v !== null) return v;
      const { idx, sixHourly } = t6[d];
      if (sixHourly.length < 4) return null;
      return compute(idx, sixHourly);
    });
    daily.series[id] = { ...s, values, note: s.note ? `${s.note} ${note}` : note };
  };
  const tvals = series.temperature?.values ?? [];
  fill('temperature_max', (idx) => aggregate(idx.map((i) => tvals[i]), 'max'), 'Beyond ~3 days, from 6-hourly values (may miss the true peak).');
  fill('temperature_min', (idx) => aggregate(idx.map((i) => tvals[i]), 'min'), 'Beyond ~3 days, from 6-hourly values (may miss the true minimum).');
  fill(
    'precipitation',
    (_idx, six) => aggregate(six.map((i) => n(steps[i].data.next_6_hours?.details?.precipitation_amount)), 'sum'),
    'Beyond ~3 days, summed from 6-hour totals.',
  );
  fill(
    'precipitation_probability',
    (_idx, six) => aggregate(six.map((i) => n(steps[i].data.next_6_hours?.details?.probability_of_precipitation)), 'max'),
    '',
  );
  daily = addCalculatedDaily(daily);

  const first = steps[0];
  const current: CurrentConditions | undefined = first
    ? {
        time: time[0],
        values: Object.fromEntries(Object.entries(hourly.series).map(([k, s]) => [k, s.values[0]])),
        condition: conditions[0],
        description: descriptions[0],
        isDay: symbols[0] ? !symbols[0].endsWith('_night') : null,
        kind: 'forecast',
        sourceNote: 'First forecast step (MET Norway nowcast), not a station observation.',
      }
    : undefined;

  return {
    providerId: 'metno',
    providerName: 'MET Norway',
    kind: 'forecast',
    location: loc,
    timezone: tz,
    fetchedAt: new Date().toISOString(),
    updatedAt: res.properties.meta.updated_at ?? null,
    current,
    hourly,
    daily,
    notes: [
      'MET Norway Locationforecast: ECMWF-based globally, with the high-resolution MEPS model over the Nordics.',
      'Hourly steps for about 2–3 days, then 6-hourly steps up to 9 days.',
    ],
    attribution: { text: 'Data from MET Norway (CC BY 4.0)', url: 'https://api.met.no/' },
  };
}

export const metno: Provider = {
  id: 'metno',
  name: 'MET Norway Locationforecast',
  shortName: 'MET Norway',
  organisation: 'Norwegian Meteorological Institute',
  kind: 'forecast',
  description: 'Global point forecasts from the Norwegian Meteorological Institute (the yr.no backend). Independent post-processing of ECMWF, with high-resolution Nordic models.',
  coverage: 'Global',
  access: 'Free, no key. Requires an identifying User-Agent (set server-side) and caching; heavy use (>20 req/s) is throttled.',
  requiresKey: false,
  enabled: true,
  url: 'https://api.met.no/weatherapi/locationforecast/2.0/documentation',
  color: '#10b981',
  supportsForecast: true,
  covers: () => true,
  async forecast(loc) {
    const params = new URLSearchParams({ lat: loc.latitude.toFixed(4), lon: loc.longitude.toFixed(4) });
    if (loc.elevation !== undefined && Number.isFinite(loc.elevation)) params.set('altitude', String(Math.round(loc.elevation)));
    const res = await getJson<MetnoResponse>(`${BASE.metno}/weatherapi/locationforecast/2.0/complete?${params}`);
    return parseMetno(res, loc, loc.timezone || 'UTC');
  },
};
