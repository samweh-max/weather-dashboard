/** Descriptive statistics and period summaries for historical and imported data. */
import { aggregate } from './calc';
import { localDate } from './time';
import { getVariable, type Aggregation } from './variables';

export interface SeriesStats {
  variable: string;
  count: number;
  expected: number;
  missing: number;
  /** 0–1 */
  completeness: number;
  min: number | null;
  minTime: string | null;
  max: number | null;
  maxTime: string | null;
  mean: number | null;
  /** Sample standard deviation (n − 1). */
  std: number | null;
  /** Only meaningful for accumulations (precipitation, snowfall, ET₀ …); null otherwise. */
  total: number | null;
}

export function describe(variable: string, times: string[], values: (number | null)[], expected = values.length): SeriesStats {
  let count = 0;
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;
  let minTime: string | null = null;
  let maxTime: string | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) continue;
    count++;
    sum += v;
    if (min === null || v < min) {
      min = v;
      minTime = times[i] ?? null;
    }
    if (max === null || v > max) {
      max = v;
      maxTime = times[i] ?? null;
    }
  }
  const mean = count ? sum / count : null;
  let std: number | null = null;
  if (count > 1 && mean !== null) {
    let ss = 0;
    for (const v of values) if (v !== null && Number.isFinite(v)) ss += (v - mean) ** 2;
    std = Math.sqrt(ss / (count - 1));
  }
  const def = getVariable(variable);
  const isDirection = def?.aggregation === 'direction';
  return {
    variable,
    count,
    expected,
    missing: Math.max(0, expected - count),
    completeness: expected > 0 ? Math.min(1, count / expected) : 0,
    min: isDirection ? null : min,
    minTime: isDirection ? null : minTime,
    max: isDirection ? null : max,
    maxTime: isDirection ? null : maxTime,
    mean: isDirection ? aggregate(values, 'direction') : mean,
    std: isDirection ? null : std,
    total: def?.aggregation === 'sum' ? (count ? sum : null) : null,
  };
}

/** Number of time steps that should exist in [start, end] (inclusive dates) at a resolution. */
export function expectedSteps(start: string, end: string, resolution: 'hourly' | 'daily'): number {
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  return Math.max(0, resolution === 'hourly' ? days * 24 : days);
}

export interface PeriodSummary {
  period: string; // "2024-03" or "2024"
  variable: string;
  value: number | null;
  aggregation: Aggregation;
  count: number;
  expected: number;
  completeness: number;
  min: number | null;
  max: number | null;
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isLeap(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Monthly or annual summaries. Accumulations are summed, everything else averaged,
 * and min/max are reported alongside. Completeness is relative to the full calendar
 * period, so partial months at the edge of a range are visible.
 */
export function periodSummaries(
  variable: string,
  times: string[],
  values: (number | null)[],
  resolution: 'hourly' | 'daily',
  period: 'month' | 'year',
  timeZone = 'UTC',
): PeriodSummary[] {
  const def = getVariable(variable);
  const agg: Aggregation = def?.aggregation === 'sum' ? 'sum' : def?.aggregation === 'direction' ? 'direction' : 'mean';
  const groups = new Map<string, (number | null)[]>();
  times.forEach((t, i) => {
    const date = resolution === 'daily' ? t.slice(0, 10) : localDate(t, timeZone);
    const key = period === 'month' ? date.slice(0, 7) : date.slice(0, 4);
    const g = groups.get(key);
    if (g) g.push(values[i]);
    else groups.set(key, [values[i]]);
  });
  const out: PeriodSummary[] = [];
  for (const [key, vals] of groups) {
    const y = Number(key.slice(0, 4));
    const days = period === 'month' ? daysInMonth(y, Number(key.slice(5, 7))) : isLeap(y) ? 366 : 365;
    const expected = resolution === 'hourly' ? days * 24 : days;
    const present = vals.filter((x) => x !== null && Number.isFinite(x)) as number[];
    out.push({
      period: key,
      variable,
      value: aggregate(vals, agg),
      aggregation: agg,
      count: present.length,
      expected,
      completeness: Math.min(1, present.length / expected),
      min: agg === 'direction' || !present.length ? null : present.reduce((a, b) => (b < a ? b : a)),
      max: agg === 'direction' || !present.length ? null : present.reduce((a, b) => (b > a ? b : a)),
    });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}
