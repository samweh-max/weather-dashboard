import { describe as d, expect, it } from 'vitest';
import { aggregate, deriveDaily, dewPoint, growingDegreeDays, heatIndex, relativeHumidity, windChill } from '@/lib/calc';
import { describe, periodSummaries } from '@/lib/stats';
import { convertForDisplay, formatValue, DEFAULT_UNITS } from '@/lib/units';
import { localDate, tzOffsetSeconds, zonedToUtc } from '@/lib/time';

d('meteorological formulas', () => {
  it('heat index matches NOAA table values', () => {
    // NOAA: 90 °F at 70 % RH → 105-106 °F
    const hiF = (heatIndex(((90 - 32) * 5) / 9, 70) * 9) / 5 + 32;
    expect(hiF).toBeGreaterThan(104.5);
    expect(hiF).toBeLessThan(106.5);
    // Below 80 °F the simple formula applies (close to air temperature)
    expect(heatIndex(20, 50)).toBeCloseTo(19.6, 0);
  });
  it('wind chill matches the Environment Canada table', () => {
    // −10 °C, 20 km/h → −17.9
    expect(windChill(-10, 20)).toBeCloseTo(-17.9, 1);
    // not defined above 10 °C
    expect(windChill(15, 30)).toBe(15);
  });
  it('dew point and RH are inverse', () => {
    const td = dewPoint(25, 60);
    expect(td).toBeCloseTo(16.7, 1);
    expect(relativeHumidity(25, td)).toBeCloseTo(60, 5);
  });
  it('growing degree days', () => {
    expect(growingDegreeDays(25, 15)).toBe(10);
    expect(growingDegreeDays(8, 2)).toBe(0);
  });
  it('vector-mean wind direction handles north wrap-around', () => {
    expect(aggregate([350, 10], 'direction')).toBeCloseTo(0, 5);
    expect(aggregate([80, 100], 'direction')).toBeCloseTo(90, 5);
  });
  it('aggregate ignores nulls and returns null for empty input', () => {
    expect(aggregate([1, null, 3], 'mean')).toBe(2);
    expect(aggregate([null, null], 'sum')).toBeNull();
  });
});

d('time zones', () => {
  it('converts local wall clock to UTC across DST', () => {
    expect(zonedToUtc('2024-07-01T12:00', 'Europe/London').toISOString()).toBe('2024-07-01T11:00:00.000Z');
    expect(zonedToUtc('2024-01-01T12:00', 'Europe/London').toISOString()).toBe('2024-01-01T12:00:00.000Z');
    expect(zonedToUtc('2024-07-01T12:00', 'America/New_York').toISOString()).toBe('2024-07-01T16:00:00.000Z');
  });
  it('local dates and offsets', () => {
    expect(localDate('2024-07-01T23:30:00Z', 'Europe/Berlin')).toBe('2024-07-02');
    expect(tzOffsetSeconds('2024-07-01T00:00:00Z', 'Asia/Kolkata')).toBe(19800);
  });
});

d('daily derivation', () => {
  it('builds daily max/min/sum by local day and skips incomplete days', () => {
    const time: string[] = [];
    const temp: number[] = [];
    const precip: number[] = [];
    // 2 full days + 5 hours in UTC
    for (let h = 0; h < 53; h++) {
      time.push(new Date(Date.UTC(2024, 0, 1, h)).toISOString().replace('.000', ''));
      temp.push(h % 24);
      precip.push(0.5);
    }
    const daily = deriveDaily({ time, series: { temperature: { values: temp, origin: 'provider' }, precipitation: { values: precip, origin: 'provider' } } }, 'UTC');
    expect(daily.time).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    expect(daily.series.temperature_max.values).toEqual([23, 23, null]);
    expect(daily.series.temperature_min.values).toEqual([0, 0, null]);
    expect(daily.series.precipitation.values[0]).toBeCloseTo(12);
    expect(daily.series.temperature_max.origin).toBe('calculated');
  });
});

d('statistics', () => {
  it('describe computes min, max, mean, sample std and completeness', () => {
    const s = describe('temperature', ['a', 'b', 'c', 'd', 'e'], [2, 4, 4, null, 6], 5);
    expect(s.count).toBe(4);
    expect(s.completeness).toBeCloseTo(0.8);
    expect(s.min).toBe(2);
    expect(s.maxTime).toBe('e');
    expect(s.mean).toBe(4);
    expect(s.std).toBeCloseTo(Math.sqrt(8 / 3));
    expect(s.total).toBeNull();
    expect(describe('precipitation', ['a', 'b'], [1.5, 2], 2).total).toBe(3.5);
  });
  it('monthly summaries sum precipitation and average temperature', () => {
    const times = ['2024-01-30', '2024-01-31', '2024-02-01'];
    const p = periodSummaries('precipitation', times, [1, 2, 5], 'daily', 'month');
    expect(p.map((x) => [x.period, x.value])).toEqual([
      ['2024-01', 3],
      ['2024-02', 5],
    ]);
    expect(p[0].completeness).toBeCloseTo(2 / 31);
    const t = periodSummaries('temperature_max', times, [10, 20, 5], 'daily', 'month');
    expect(t[0].value).toBe(15);
  });
});

d('units', () => {
  it('converts canonical values for display', () => {
    expect(convertForDisplay(100, 'temperature', { ...DEFAULT_UNITS, temperature: 'F' })).toBe(212);
    expect(convertForDisplay(36, 'speed', { ...DEFAULT_UNITS, speed: 'ms' })).toBeCloseTo(10);
    expect(convertForDisplay(25.4, 'precipitation', { ...DEFAULT_UNITS, precipitation: 'in' })).toBeCloseTo(1);
    expect(convertForDisplay(1013.25, 'pressure', { ...DEFAULT_UNITS, pressure: 'inHg' })).toBeCloseTo(29.92, 2);
    expect(formatValue('temperature', null, DEFAULT_UNITS)).toBe('—');
  });
});
