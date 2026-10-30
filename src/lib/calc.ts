/**
 * Meteorological calculations and aggregation. Everything works in canonical units
 * (°C, km/h, %, mm …). Calculated series are always labelled `origin: 'calculated'`.
 */
import type { Series, TimeBlock, WeatherDataset } from './types';
import { DAILY_FROM_HOURLY, getVariable, type Aggregation } from './variables';
import { localDate } from './time';

const cToF = (c: number) => (c * 9) / 5 + 32;
const fToC = (f: number) => ((f - 32) * 5) / 9;

/** NOAA heat index (Rothfusz regression with Steadman fallback and adjustments). Input °C, %RH. */
export function heatIndex(tempC: number, rh: number): number {
  const T = cToF(tempC);
  const simple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + rh * 0.094);
  if ((simple + T) / 2 < 80) return fToC(simple);
  let hi =
    -42.379 +
    2.04901523 * T +
    10.14333127 * rh -
    0.22475541 * T * rh -
    0.00683783 * T * T -
    0.05481717 * rh * rh +
    0.00122874 * T * T * rh +
    0.00085282 * T * rh * rh -
    0.00000199 * T * T * rh * rh;
  if (rh < 13 && T >= 80 && T <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  else if (rh > 85 && T >= 80 && T <= 87) hi += ((rh - 85) / 10) * ((87 - T) / 5);
  return fToC(hi);
}

/** NWS / Environment Canada wind chill. Input °C and km/h. Returns air temp outside its valid range. */
export function windChill(tempC: number, windKmh: number): number {
  if (tempC > 10 || windKmh <= 4.8) return tempC;
  const v = Math.pow(windKmh, 0.16);
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
}

/** Magnus formula dew point. Input °C, %RH. */
export function dewPoint(tempC: number, rh: number): number {
  const a = 17.625;
  const b = 243.04;
  const g = Math.log(Math.max(rh, 1e-6) / 100) + (a * tempC) / (b + tempC);
  return (b * g) / (a - g);
}

/** Relative humidity from temperature and dew point (Magnus). */
export function relativeHumidity(tempC: number, dewC: number): number {
  const a = 17.625;
  const b = 243.04;
  return 100 * Math.exp((a * dewC) / (b + dewC) - (a * tempC) / (b + tempC));
}

/** Growing degree days with base temperature (default 10 °C). */
export function growingDegreeDays(tmax: number, tmin: number, base = 10): number {
  return Math.max(0, (tmax + tmin) / 2 - base);
}

/* --------------------------------- aggregation --------------------------------- */

export function aggregate(values: (number | null)[], how: Aggregation): number | null {
  const xs = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (!xs.length) return null;
  switch (how) {
    case 'sum':
      return xs.reduce((a, b) => a + b, 0);
    case 'max':
      return xs.reduce((a, b) => (b > a ? b : a), -Infinity);
    case 'min':
      return xs.reduce((a, b) => (b < a ? b : a), Infinity);
    case 'direction': {
      let sx = 0;
      let sy = 0;
      for (const d of xs) {
        sx += Math.sin((d * Math.PI) / 180);
        sy += Math.cos((d * Math.PI) / 180);
      }
      if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return null;
      return ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
    }
    default:
      return xs.reduce((a, b) => a + b, 0) / xs.length;
  }
}

/** Group indices of hourly UTC timestamps by local calendar day. */
export function groupByLocalDay(times: string[], timeZone: string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  times.forEach((t, i) => {
    const day = localDate(t, timeZone);
    const g = groups.get(day);
    if (g) g.push(i);
    else groups.set(day, [i]);
  });
  return groups;
}

/**
 * Build daily values from hourly data for any daily variable the provider did not
 * publish. Days with fewer than `minHours` hourly values are left empty rather than
 * reported from partial data (sums especially would be misleading).
 */
export function deriveDaily(hourly: TimeBlock, timeZone: string, existing?: TimeBlock, minHours = 18): TimeBlock {
  const groups = groupByLocalDay(hourly.time, timeZone);
  const days = existing?.time.length ? existing.time : [...groups.keys()];
  const out: TimeBlock = {
    time: days,
    series: { ...(existing?.series ?? {}) },
    conditions: existing?.conditions,
    descriptions: existing?.descriptions,
  };
  for (const [dailyId, { from, agg }] of Object.entries(DAILY_FROM_HOURLY)) {
    if (out.series[dailyId]?.values.some((x) => x !== null)) continue;
    const src = hourly.series[from];
    if (!src || !src.values.some((x) => x !== null)) continue;
    const values = days.map((day) => {
      const idx = groups.get(day);
      if (!idx) return null;
      const vals = idx.map((i) => src.values[i]);
      const present = vals.filter((x) => x !== null).length;
      if (present === 0 || present < minHours) return null;
      return aggregate(vals, agg);
    });
    out.series[dailyId] = {
      values,
      origin: 'calculated',
      note: `Daily ${agg === 'direction' ? 'vector-mean' : agg} of hourly ${getVariable(from)?.label.toLowerCase() ?? from}, by local day.`,
    };
  }
  if (!out.conditions && hourly.conditions) {
    out.conditions = days.map((day) => {
      const idx = groups.get(day) ?? [];
      return worstCondition(idx.map((i) => hourly.conditions?.[i] ?? null));
    });
  }
  return out;
}

const CONDITION_SEVERITY: Record<string, number> = {
  clear: 0,
  'partly-cloudy': 1,
  cloudy: 2,
  fog: 3,
  drizzle: 4,
  rain: 5,
  sleet: 6,
  snow: 7,
  'heavy-rain': 8,
  thunderstorm: 9,
};

/** Summarise a day's conditions by the most significant weather (daytime-biased). */
export function worstCondition<T extends string | null>(xs: T[]): T | null {
  let best: T | null = null;
  let score = -1;
  for (const c of xs) {
    if (!c) continue;
    const s = CONDITION_SEVERITY[c] ?? 0;
    if (s > score) {
      score = s;
      best = c;
    }
  }
  return best;
}

/** Add calculated hourly series (heat index, wind chill, dew point) where inputs exist and the provider didn't supply them. */
export function addCalculatedHourly(block: TimeBlock): TimeBlock {
  const t = block.series.temperature?.values;
  const rh = block.series.relative_humidity?.values;
  const ws = block.series.wind_speed?.values;
  const series = { ...block.series };
  const hasData = (s?: Series) => !!s && s.values.some((x) => x !== null);
  if (t && rh && !hasData(series.heat_index)) {
    series.heat_index = {
      values: t.map((x, i) => (x !== null && rh[i] !== null ? heatIndex(x, rh[i] as number) : null)),
      origin: 'calculated',
      note: 'NOAA heat index from temperature and humidity.',
    };
  }
  if (t && ws && !hasData(series.wind_chill)) {
    series.wind_chill = {
      values: t.map((x, i) => (x !== null && ws[i] !== null ? windChill(x, ws[i] as number) : null)),
      origin: 'calculated',
      note: 'NWS wind chill from temperature and wind speed.',
    };
  }
  if (t && rh && !hasData(series.dew_point)) {
    series.dew_point = {
      values: t.map((x, i) => (x !== null && rh[i] !== null ? dewPoint(x, rh[i] as number) : null)),
      origin: 'calculated',
      note: 'Magnus-formula dew point from temperature and humidity.',
    };
  }
  return { ...block, series };
}

/** Add calculated daily series (growing degree days). */
export function addCalculatedDaily(block: TimeBlock): TimeBlock {
  const mx = block.series.temperature_max?.values;
  const mn = block.series.temperature_min?.values;
  const series = { ...block.series };
  if (mx && mn && !series.growing_degree_days) {
    series.growing_degree_days = {
      values: mx.map((x, i) => (x !== null && mn[i] !== null ? growingDegreeDays(x, mn[i] as number) : null)),
      origin: 'calculated',
      note: 'Base 10 °C, from daily max and min.',
    };
  }
  return { ...block, series };
}

/** Run all derivations on a fresh provider dataset. */
export function enrichDataset(ds: WeatherDataset, minHours = 18): WeatherDataset {
  let hourly = ds.hourly;
  let daily = ds.daily;
  if (hourly) hourly = addCalculatedHourly(hourly);
  if (hourly) daily = deriveDaily(hourly, ds.timezone, daily, minHours);
  if (daily) daily = addCalculatedDaily(daily);
  return { ...ds, hourly, daily };
}
