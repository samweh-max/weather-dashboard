import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetToken, buildHourly, homeStation, mapStreams, parseLatest, readConfig, unitConverter, type DatapointsResponse } from '@/lib/providers/campbellon';

// All values below are synthetic test fixtures shaped like the CampbellON API examples, not real station data.

const streams = [
  { id: 't', field: 'AirTemp_C', table: 'MetData', unit: '°C' },
  { id: 'rh', field: 'RH', table: 'MetData', unit: '%' },
  { id: 'ws', field: 'WS_ms_Avg', table: 'MetData', unit: 'm/s' },
  { id: 'wsmax', field: 'WS_ms_Max', table: 'MetData', unit: 'm/s' },
  { id: 'wd', field: 'WindDir', table: 'MetData', unit: 'deg' },
  { id: 'bp', field: 'BP_mbar', table: 'MetData', unit: 'mbar' },
  { id: 'rain', field: 'Rain_mm_Tot', table: 'MetData', unit: 'mm' },
  { id: 'batt', field: 'BattV_Min', table: 'Status', unit: 'V' },
  { id: 'ptemp', field: 'PTemp_C', table: 'Status', unit: '°C' },
  { id: 'odd', field: 'SlrW_Avg', table: 'MetData', unit: 'lux' },
];

describe('CampbellON field mapping', () => {
  it('maps conventional Campbell field names and leaves the rest out', () => {
    const { mapped, skipped } = mapStreams(streams);
    const byVar = Object.fromEntries(mapped.map((m) => [m.variable, m.field]));
    expect(byVar).toEqual({
      wind_gusts: 'WS_ms_Max',
      temperature: 'AirTemp_C',
      relative_humidity: 'RH',
      wind_direction: 'WindDir',
      wind_speed: 'WS_ms_Avg',
      surface_pressure: 'BP_mbar',
      precipitation: 'Rain_mm_Tot',
    });
    // Panel temperature must never be taken for air temperature
    expect(skipped).toContain('PTemp_C');
    expect(skipped).toContain('BattV_Min');
    // A recognised field with an unknown unit is skipped, not guessed
    expect(skipped.some((s) => s.startsWith('SlrW_Avg (unrecognised unit "lux"'))).toBe(true);
  });

  it('converts units into canonical ones', () => {
    expect(unitConverter('temperature', '°F')!(212)).toBeCloseTo(100);
    expect(unitConverter('wind_speed', 'm/s')!(10)).toBeCloseTo(36);
    expect(unitConverter('wind_speed', 'mph')!(10)).toBeCloseTo(16.09, 1);
    expect(unitConverter('surface_pressure', 'inHg')!(29.92)).toBeCloseTo(1013.2, 0);
    expect(unitConverter('surface_pressure', 'kPa')!(101.3)).toBeCloseTo(1013);
    expect(unitConverter('precipitation', 'in')!(1)).toBeCloseTo(25.4);
    expect(unitConverter('temperature', 'K')).toBeNull();
  });
});

describe('CampbellON parsing', () => {
  it('builds current conditions from the latest readings and drops stale ones', () => {
    const now = Date.parse('2026-03-26T15:00:00Z');
    const cur = parseLatest(
      {
        data: {
          t: { ts: '2026-03-26T14:55:00Z', value: 18.7, field_name: 'AirTemp_C', unit: '°C' },
          ws: { ts: '2026-03-26T14:55:00Z', value: 5, field_name: 'WS_ms_Avg', unit: 'm/s' },
          rh: { ts: '2026-03-25T08:00:00Z', value: 80, field_name: 'RH', unit: '%' }, // > 3 h old
          rain: { ts: '2026-03-26T14:55:00Z', value: 0.2, field_name: 'Rain_mm_Tot', unit: 'mm' },
        },
      },
      now,
    )!;
    expect(cur.kind).toBe('observation');
    expect(cur.time).toBe('2026-03-26T14:55:00Z');
    expect(cur.values.temperature).toBe(18.7);
    expect(cur.values.wind_speed).toBeCloseTo(18);
    expect(cur.values.relative_humidity).toBeUndefined();
    expect(cur.values.precipitation).toBeUndefined();
  });

  it('returns null when nothing is recent', () => {
    expect(parseLatest({ data: { t: { ts: '2020-01-01T00:00:00Z', value: 1, field_name: 'AirTemp_C', unit: '°C' } } })).toBeNull();
  });

  it('merges hourly means, hourly maxima and summed raw rain into one hourly block', () => {
    const { mapped } = mapStreams(streams);
    const avg: DatapointsResponse = {
      data: [
        { ts: '2026-03-01T00:00:00Z', v: { t: 10, ws: 2, rh: 90 } },
        { ts: '2026-03-01T01:00:00Z', v: { t: 9.5, ws: null, rh: 91 } },
      ],
    };
    const max: DatapointsResponse = { data: [{ ts: '2026-03-01T00:00:00Z', v: { wsmax: 6 } }] };
    // Raw rain stamped at the end of each 15-min interval: 00:15, 00:30, 00:45, 01:00 all belong to hour 00
    const raw: DatapointsResponse = {
      data: [
        { ts: '2026-03-01T00:15:00Z', v: { rain: 0.2 } },
        { ts: '2026-03-01T00:30:00Z', v: { rain: 0 } },
        { ts: '2026-03-01T00:45:00Z', v: { rain: 0.4 } },
        { ts: '2026-03-01T01:00:00Z', v: { rain: 0.2 } },
        { ts: '2026-03-01T01:15:00Z', v: { rain: 1 } },
      ],
    };
    const h = buildHourly(mapped, { avg, max, raw }, 'UTC', '2026-03-01', '2026-03-01');
    expect(h.time).toEqual(['2026-03-01T00:00:00Z', '2026-03-01T01:00:00Z']);
    expect(h.series.temperature.values).toEqual([10, 9.5]);
    expect(h.series.wind_speed.values[0]).toBeCloseTo(7.2);
    expect(h.series.wind_speed.values[1]).toBeNull(); // missing stays missing
    expect(h.series.wind_gusts.values[0]).toBeCloseTo(21.6);
    expect(h.series.precipitation.values[0]).toBeCloseTo(0.8);
    expect(h.series.precipitation.values[1]).toBeCloseTo(1);
    expect(h.series.temperature.origin).toBe('provider');
  });

  it('drops hours outside the requested local dates', () => {
    const { mapped } = mapStreams(streams);
    const avg: DatapointsResponse = { data: [{ ts: '2026-02-28T23:00:00Z', v: { t: 1 } }, { ts: '2026-03-01T00:00:00Z', v: { t: 2 } }] };
    const h = buildHourly(mapped, { avg }, 'UTC', '2026-03-01', '2026-03-01');
    expect(h.series.temperature.values).toEqual([2]);
  });
});

describe('CampbellON config', () => {
  it('needs org, station and a sign-in method', () => {
    expect(readConfig({ CAMPBELLON_ORG_ID: 'o', CAMPBELLON_STATION_ID: 's' })).toBeNull();
    expect(readConfig({ CAMPBELLON_ORG_ID: 'o', CAMPBELLON_STATION_ID: 's', CAMPBELLON_CLIENT_ID: 'c', CAMPBELLON_CLIENT_SECRET: 'x' })?.auth.grant_type).toBe('client_credentials');
    expect(readConfig({ CAMPBELLON_ORG_ID: 'o', CAMPBELLON_STATION_ID: 's', CAMPBELLON_USERNAME: 'u', CAMPBELLON_PASSWORD: 'p' })?.auth).toEqual({ grant_type: 'password', client_id: 'cloud', username: 'u', password: 'p' });
  });
});

describe('CampbellON history (mocked fetch)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    _resetToken();
  });

  it('signs in once, then reads datastreams and datapoints with the bearer token', async () => {
    vi.stubEnv('CAMPBELLON_BASE', 'http://mock.test');
    vi.stubEnv('CAMPBELLON_ORG_ID', 'org-1');
    vi.stubEnv('CAMPBELLON_STATION_ID', 'st-1');
    vi.stubEnv('CAMPBELLON_CLIENT_ID', 'sa-test');
    vi.stubEnv('CAMPBELLON_CLIENT_SECRET', 'not-a-real-secret');
    const calls: { url: string; auth?: string; method?: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>)?.Authorization;
      calls.push({ url, auth, method: init.method });
      const u = new URL(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.pathname === '/api/v1/tokens') return json({ access_token: 'tok', expires_in: 3600 });
      if (u.pathname.endsWith('/datastreams'))
        return json([
          { id: 't', metadata: { field: 'AirTemp_C', uom: '°C', status: 'active' } },
          { id: 'rain', metadata: { field: 'Rain_mm_Tot', uom: 'mm', status: 'active' } },
        ]);
      if (u.pathname.endsWith('/datapoints')) {
        if (u.searchParams.get('resolution') === 'raw') return json({ data: [{ ts: '2026-03-01T12:15:00Z', v: { rain: 0.5 } }] });
        return json({ data: [{ ts: '2026-03-01T12:00:00Z', v: { t: 11 } }] });
      }
      return new Response('{}', { status: 404 });
    });
    const loc = { name: 'Home', latitude: 0, longitude: 0, timezone: 'UTC' };
    const ds = await homeStation.history!(loc, '2026-03-01', '2026-03-01', { resolution: 'hourly' });
    expect(ds.kind).toBe('observation');
    expect(ds.hourly!.series.temperature.values).toEqual([11]);
    expect(ds.hourly!.series.precipitation.values).toEqual([0.5]);
    expect(calls.filter((c) => c.url.endsWith('/api/v1/tokens'))).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls.slice(1).every((c) => c.auth === 'Bearer tok')).toBe(true);
    const ds1 = calls.find((c) => c.url.includes('/datastreams'))!;
    expect(new URL(ds1.url).searchParams.get('stationId')).toBe('st-1');
  });
});
