import { describe, expect, it } from 'vitest';
import { parseOpenMeteo } from '@/lib/providers/openmeteo';
import { parseMetno, type MetnoResponse } from '@/lib/providers/metno';
import { expandLayer, nwsToCanonical, parseValidTime } from '@/lib/providers/nws';
import { parseMetOffice } from '@/lib/providers/metoffice';
import { metnoSymbolToCondition, textToCondition, wmoToCondition } from '@/lib/conditions';

const loc = { name: 'London', latitude: 51.5, longitude: -0.12, timezone: 'Europe/London' };
const t0 = Date.UTC(2024, 6, 1) / 1000; // 2024-07-01 00:00 UTC = 01:00 BST

function omFixture() {
  const hours = Array.from({ length: 48 }, (_, i) => t0 - 3600 + i * 3600); // local midnight start
  return {
    latitude: 51.5,
    longitude: -0.12,
    elevation: 11,
    timezone: 'Europe/London',
    utc_offset_seconds: 3600,
    current: { time: t0 + 1800, temperature_2m: 18.4, relative_humidity_2m: 70, weather_code: 61, is_day: 1, wind_speed_10m: 12.3, wind_direction_10m: 240, pressure_msl: 1012.1 },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 15 + (i % 24) / 2),
      relative_humidity_2m: hours.map(() => 70),
      wind_speed_10m: hours.map(() => 10),
      snow_depth: hours.map(() => 0.05),
      visibility: hours.map(() => 24000),
      cape: hours.map(() => null), // model doesn't provide it
      weather_code: hours.map(() => 3),
      uv_index: hours.map((_, i) => (i === 1 ? 4 : 0)),
    },
    daily: {
      time: [t0 - 3600, t0 - 3600 + 86400],
      temperature_2m_max: [26.5, 24],
      temperature_2m_min: [15, 14],
      precipitation_sum: [1.2, 0],
      sunrise: [t0 + 3 * 3600, t0 + 27 * 3600],
      sunset: [t0 + 20 * 3600, t0 + 44 * 3600],
      daylight_duration: [59400, 59000],
      weather_code: [61, 2],
    },
  };
}

describe('Open-Meteo parsing', () => {
  it('normalises units, times and drops all-null variables', () => {
    const ds = parseOpenMeteo(omFixture() as never, {
      providerId: 'om-best',
      providerName: 'Open-Meteo',
      kind: 'forecast',
      location: loc,
      attribution: { text: '', url: '' },
      notes: [],
    });
    expect(ds.hourly!.time[0]).toBe('2024-06-30T23:00:00Z');
    expect(ds.daily!.time).toEqual(['2024-07-01', '2024-07-02']);
    expect(ds.hourly!.series.snow_depth.values[0]).toBeCloseTo(5); // m → cm
    expect(ds.hourly!.series.visibility.values[0]).toBe(24); // m → km
    expect(ds.hourly!.series.cape).toBeUndefined();
    expect(ds.daily!.series.daylight_duration.values[0]).toBeCloseTo(16.5);
    expect(ds.current!.values.temperature).toBe(18.4);
    expect(ds.current!.values.uv_index).toBe(4); // filled from the matching hour
    expect(ds.current!.condition).toBe('rain');
    expect(ds.astro![0].sunrise).toBe('2024-07-01T03:00:00Z');
    // calculated series are labelled
    expect(ds.hourly!.series.heat_index.origin).toBe('calculated');
    expect(ds.daily!.series.temperature_mean.origin).toBe('calculated');
    expect(ds.daily!.series.temperature_max.origin).toBe('provider');
    expect(ds.daily!.series.growing_degree_days.values[0]).toBeCloseTo(10.75);
  });
});

describe('MET Norway parsing', () => {
  it('converts m/s to km/h and builds daily values', () => {
    const steps = Array.from({ length: 30 }, (_, i) => ({
      time: new Date((t0 - 3600 + i * 3600) * 1000).toISOString().replace('.000', ''),
      data: {
        instant: { details: { air_temperature: 10 + i * 0.1, wind_speed: 5, relative_humidity: 80, air_pressure_at_sea_level: 1015 } },
        next_1_hours: { summary: { symbol_code: 'lightrain_day' }, details: { precipitation_amount: 0.2, probability_of_precipitation: 40 } },
      },
    }));
    const res: MetnoResponse = { properties: { meta: { updated_at: '2024-07-01T00:00:00Z' }, timeseries: steps } };
    const ds = parseMetno(res, loc, 'Europe/London');
    expect(ds.hourly!.series.wind_speed.values[0]).toBe(18);
    expect(ds.updatedAt).toBe('2024-07-01T00:00:00Z');
    expect(ds.current!.condition).toBe('drizzle');
    expect(ds.daily!.time[0]).toBe('2024-07-01');
    expect(ds.daily!.series.precipitation.values[0]).toBeCloseTo(4.8);
  });
});

describe('NWS parsing', () => {
  it('parses ISO-8601 validTime durations', () => {
    expect(parseValidTime('2024-07-01T06:00:00+00:00/PT6H')).toEqual([Date.UTC(2024, 6, 1, 6), 6]);
    expect(parseValidTime('2024-07-01T06:00:00+00:00/P1DT2H')[1]).toBe(26);
  });
  it('expands gridpoint layers and spreads accumulations', () => {
    const times = ['2024-07-01T06:00:00Z', '2024-07-01T07:00:00Z', '2024-07-01T08:00:00Z'];
    const temp = expandLayer({ uom: 'wmoUnit:degF', values: [{ validTime: '2024-07-01T06:00:00+00:00/PT2H', value: 50 }] }, times);
    expect(temp[0]).toBeCloseTo(10);
    expect(temp[1]).toBeCloseTo(10);
    expect(temp[2]).toBeNull();
    const qpf = expandLayer({ uom: 'wmoUnit:mm', values: [{ validTime: '2024-07-01T06:00:00+00:00/PT3H', value: 6 }] }, times, { accumulate: true });
    expect(qpf).toEqual([2, 2, 2]);
  });
  it('converts unit codes', () => {
    expect(nwsToCanonical(101325, 'wmoUnit:Pa')).toBeCloseTo(1013.25);
    expect(nwsToCanonical(10, 'wmoUnit:m_s-1')).toBe(36);
    expect(nwsToCanonical(null, 'wmoUnit:Pa')).toBeNull();
  });
});

describe('Met Office DataHub parsing', () => {
  it('converts Pa, m/s and m', () => {
    const ds = parseMetOffice(
      {
        features: [
          {
            properties: {
              modelRunDate: '2024-07-01T00:00Z',
              timeSeries: [
                { time: '2099-07-01T00:00Z', screenTemperature: 14, mslp: 101300, windSpeed10m: 5, visibility: 20000, significantWeatherCode: 12 },
              ],
            },
          },
        ],
      },
      loc,
      'Europe/London',
    );
    expect(ds.hourly!.time[0]).toBe('2099-07-01T00:00:00Z');
    expect(ds.hourly!.series.pressure_msl.values[0]).toBe(1013);
    expect(ds.hourly!.series.wind_speed.values[0]).toBe(18);
    expect(ds.hourly!.series.visibility.values[0]).toBe(20);
    expect(ds.current!.description).toBe('Light rain');
  });
});

describe('condition mapping', () => {
  it('maps codes and text', () => {
    expect(wmoToCondition(95)).toBe('thunderstorm');
    expect(wmoToCondition(0)).toBe('clear');
    expect(metnoSymbolToCondition('heavysnowshowers_night')).toBe('snow');
    expect(textToCondition('Chance Showers And Thunderstorms')).toBe('thunderstorm');
    expect(textToCondition('Mostly Sunny')).toBe('partly-cloudy');
  });
});
