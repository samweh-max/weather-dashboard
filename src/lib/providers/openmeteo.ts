import 'server-only';
import { enrichDataset } from '../calc';
import { WMO_DESCRIPTIONS, wmoToCondition } from '../conditions';
import { BASE, getJson } from '../server/http';
import { localDate, toIsoUtc } from '../time';
import type { CurrentConditions, DailyAstro, DataKind, Location, Series, TimeBlock, WeatherDataset } from '../types';
import type { Provider } from './types';

/**
 * Open-Meteo: free, keyless, global. Non-commercial use up to 10 000 calls/day,
 * 5 000/hour, 600/minute. Data CC BY 4.0. https://open-meteo.com/en/terms
 *
 * Open-Meteo also republishes the raw output of national weather models (ECMWF,
 * NOAA GFS, DWD ICON, Met Office UKMO, Météo-France, Environment Canada, JMA), which
 * lets us offer genuinely independent forecasts without any API keys.
 */

type Conv = (x: number) => number;
const same: Conv = (x) => x;
const mToCm: Conv = (x) => x * 100;
const mToKm: Conv = (x) => x / 1000;
const sToH: Conv = (x) => x / 3600;

/** Our variable id → [Open-Meteo field, conversion]. */
export const OM_HOURLY: Record<string, [string, Conv]> = {
  temperature: ['temperature_2m', same],
  relative_humidity: ['relative_humidity_2m', same],
  dew_point: ['dew_point_2m', same],
  apparent_temperature: ['apparent_temperature', same],
  precipitation_probability: ['precipitation_probability', same],
  precipitation: ['precipitation', same],
  rain: ['rain', same],
  snowfall: ['snowfall', same],
  snow_depth: ['snow_depth', mToCm],
  pressure_msl: ['pressure_msl', same],
  surface_pressure: ['surface_pressure', same],
  cloud_cover: ['cloud_cover', same],
  visibility: ['visibility', mToKm],
  wind_speed: ['wind_speed_10m', same],
  wind_direction: ['wind_direction_10m', same],
  wind_gusts: ['wind_gusts_10m', same],
  uv_index: ['uv_index', same],
  shortwave_radiation: ['shortwave_radiation', same],
  sunshine_duration: ['sunshine_duration', sToH],
  cape: ['cape', same],
  lifted_index: ['lifted_index', same],
  freezing_level: ['freezing_level_height', same],
  vapour_pressure_deficit: ['vapour_pressure_deficit', same],
  et0: ['et0_fao_evapotranspiration', same],
  soil_temperature_0cm: ['soil_temperature_0cm', same],
  soil_temperature_6cm: ['soil_temperature_6cm', same],
  soil_moisture_0_1cm: ['soil_moisture_0_to_1cm', same],
  soil_moisture_1_3cm: ['soil_moisture_1_to_3cm', same],
};

export const OM_DAILY: Record<string, [string, Conv]> = {
  temperature_max: ['temperature_2m_max', same],
  temperature_min: ['temperature_2m_min', same],
  apparent_temperature_max: ['apparent_temperature_max', same],
  apparent_temperature_min: ['apparent_temperature_min', same],
  precipitation: ['precipitation_sum', same],
  rain: ['rain_sum', same],
  snowfall: ['snowfall_sum', same],
  precipitation_hours: ['precipitation_hours', same],
  precipitation_probability: ['precipitation_probability_max', same],
  wind_speed_max: ['wind_speed_10m_max', same],
  wind_gusts_max: ['wind_gusts_10m_max', same],
  wind_direction: ['wind_direction_10m_dominant', same],
  uv_index_max: ['uv_index_max', same],
  shortwave_radiation_sum: ['shortwave_radiation_sum', same],
  sunshine_duration: ['sunshine_duration', sToH],
  daylight_duration: ['daylight_duration', sToH],
  et0: ['et0_fao_evapotranspiration', same],
};

/** The archive (ERA5) API has a slightly different variable set. */
const ARCHIVE_HOURLY_EXCLUDE = new Set(['precipitation_probability', 'uv_index', 'visibility', 'cape', 'lifted_index', 'freezing_level', 'soil_temperature_6cm', 'soil_moisture_1_3cm']);
const ARCHIVE_DAILY_EXCLUDE = new Set(['precipitation_probability', 'uv_index_max']);
const ARCHIVE_HOURLY_EXTRA: Record<string, [string, Conv]> = {
  soil_temperature_0cm: ['soil_temperature_0_to_7cm', same],
  soil_moisture_0_1cm: ['soil_moisture_0_to_7cm', same],
};

const CURRENT_FIELDS: Record<string, [string, Conv]> = {
  temperature: ['temperature_2m', same],
  relative_humidity: ['relative_humidity_2m', same],
  apparent_temperature: ['apparent_temperature', same],
  precipitation: ['precipitation', same],
  cloud_cover: ['cloud_cover', same],
  pressure_msl: ['pressure_msl', same],
  surface_pressure: ['surface_pressure', same],
  wind_speed: ['wind_speed_10m', same],
  wind_direction: ['wind_direction_10m', same],
  wind_gusts: ['wind_gusts_10m', same],
};

interface OmResponse {
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone: string;
  utc_offset_seconds: number;
  current?: Record<string, number | null> & { time: number };
  hourly?: Record<string, (number | null)[]> & { time: number[] };
  daily?: Record<string, (number | null)[]> & { time: number[] };
}

function toSeries(raw: (number | null)[] | undefined, conv: Conv): Series | undefined {
  if (!raw) return undefined;
  return { values: raw.map((x) => (x === null || x === undefined || !Number.isFinite(x) ? null : conv(x))), origin: 'provider' };
}

function buildBlock(raw: OmResponse['hourly'], map: Record<string, [string, Conv]>, daily: boolean, tz: string): TimeBlock | undefined {
  if (!raw?.time) return undefined;
  const time = raw.time.map((t) => (daily ? localDate(t * 1000, tz) : toIsoUtc(t * 1000)));
  const series: Record<string, Series> = {};
  for (const [id, [field, conv]] of Object.entries(map)) {
    const s = toSeries(raw[field] as (number | null)[] | undefined, conv);
    // keep a series only if the model actually supplied something
    if (s && s.values.some((x) => x !== null)) series[id] = s;
  }
  const codes = raw.weather_code as (number | null)[] | undefined;
  return {
    time,
    series,
    conditions: codes?.map(wmoToCondition),
    descriptions: codes?.map((c) => (c === null || c === undefined ? null : (WMO_DESCRIPTIONS[c] ?? null))),
  };
}

export function parseOpenMeteo(
  res: OmResponse,
  meta: { providerId: string; providerName: string; kind: DataKind; location: Location; attribution: WeatherDataset['attribution']; notes: string[]; archive?: boolean },
): WeatherDataset {
  const tz = res.timezone || 'UTC';
  const hourlyMap = meta.archive ? { ...Object.fromEntries(Object.entries(OM_HOURLY).filter(([k]) => !ARCHIVE_HOURLY_EXCLUDE.has(k))), ...ARCHIVE_HOURLY_EXTRA } : OM_HOURLY;
  const dailyMap = meta.archive ? { ...Object.fromEntries(Object.entries(OM_DAILY).filter(([k]) => !ARCHIVE_DAILY_EXCLUDE.has(k))), temperature_mean: ['temperature_2m_mean', same] as [string, Conv] } : OM_DAILY;
  const hourly = buildBlock(res.hourly, hourlyMap, false, tz);
  const daily = buildBlock(res.daily, dailyMap, true, tz);

  let astro: DailyAstro[] | undefined;
  if (res.daily?.sunrise && daily) {
    astro = daily.time.map((date, i) => {
      const sr = res.daily?.sunrise?.[i];
      const ss = res.daily?.sunset?.[i];
      return { date, sunrise: sr ? toIsoUtc(sr * 1000) : null, sunset: ss ? toIsoUtc(ss * 1000) : null };
    });
  }

  let current: CurrentConditions | undefined;
  if (res.current) {
    const values: Record<string, number | null> = {};
    for (const [id, [field, conv]] of Object.entries(CURRENT_FIELDS)) {
      const x = res.current[field];
      values[id] = x === null || x === undefined ? null : conv(x);
    }
    // Fill current UV / visibility / dew point from the matching hourly step
    if (hourly) {
      const t = toIsoUtc(Math.floor(res.current.time / 3600) * 3600 * 1000);
      const idx = hourly.time.indexOf(t);
      if (idx >= 0) {
        for (const id of ['uv_index', 'visibility', 'dew_point', 'precipitation_probability']) {
          const s = hourly.series[id];
          if (s && values[id] === undefined) values[id] = s.values[idx];
        }
      }
    }
    const code = res.current.weather_code;
    current = {
      time: toIsoUtc(res.current.time * 1000),
      values,
      condition: wmoToCondition(code),
      description: code === null || code === undefined ? null : (WMO_DESCRIPTIONS[code] ?? null),
      isDay: res.current.is_day === null || res.current.is_day === undefined ? null : res.current.is_day === 1,
      kind: 'forecast',
      sourceNote: 'Model analysis for the current 15-minute step, not a station observation.',
    };
  }

  return enrichDataset({
    providerId: meta.providerId,
    providerName: meta.providerName,
    kind: meta.kind,
    location: { ...meta.location, timezone: meta.location.timezone || tz, elevation: meta.location.elevation ?? res.elevation },
    timezone: tz,
    fetchedAt: new Date().toISOString(),
    updatedAt: null,
    current,
    hourly,
    daily,
    astro,
    notes: meta.notes,
    attribution: meta.attribution,
  });
}

/**
 * Call an Open-Meteo endpoint. If the API rejects one variable name (e.g. a model
 * or endpoint that does not know it), drop that variable and retry rather than
 * failing the whole request.
 */
export async function omFetch<T>(base: string, path: string, params: URLSearchParams, timeoutMs = 15000): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await getJson<T>(`${base}${path}?${params}`, { timeoutMs });
    } catch (e) {
      const msg = (e as Error).message;
      const m = msg.match(/invalid String value ([A-Za-z0-9_]+)/);
      if (!m) throw e;
      let removed = false;
      for (const key of ['hourly', 'daily', 'current']) {
        const list = params.get(key)?.split(',') ?? [];
        if (list.includes(m[1])) {
          params.set(key, list.filter((f) => f !== m[1]).join(','));
          removed = true;
        }
      }
      if (!removed) throw e;
    }
  }
  throw new Error('Open-Meteo rejected too many variables');
}

const OM_ATTRIBUTION = { text: 'Weather data by Open-Meteo.com (CC BY 4.0)', url: 'https://open-meteo.com/' };

/** Open-Meteo model metadata endpoint names, used to show when the model last ran. */
const MODEL_META: Record<string, string> = {
  ecmwf_ifs025: 'ecmwf_ifs025',
  gfs_seamless: 'ncep_gfs025',
  icon_seamless: 'dwd_icon',
  ukmo_seamless: 'ukmo_global_deterministic_10km',
  meteofrance_seamless: 'meteofrance_arpege_world025',
  gem_seamless: 'cmc_gem_gdps',
  jma_seamless: 'jma_gsm',
};

async function modelRunTime(model: string): Promise<string | null> {
  const metaName = MODEL_META[model];
  if (!metaName) return null;
  try {
    const j = await getJson<{ last_run_initialisation_time?: number; last_run_availability_time?: number }>(`${BASE.openMeteo}/data/${metaName}/static/meta.json`, { timeoutMs: 5000 });
    const t = j.last_run_availability_time ?? j.last_run_initialisation_time;
    return t ? new Date(t * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

export interface OmModel {
  id: string;
  model: string;
  name: string;
  shortName: string;
  organisation: string;
  description: string;
  color: string;
  coverage?: string;
  days: number;
}

export const OM_MODELS: OmModel[] = [
  { id: 'om-best', model: 'best_match', name: 'Open-Meteo Best Match', shortName: 'Open-Meteo', organisation: 'Open-Meteo', description: 'Open-Meteo blends the best available national and global models for each location (e.g. DWD ICON-D2 in Germany, Met Office UKV in the UK, NOAA HRRR in the US).', color: '#38bdf8', days: 16 },
  { id: 'om-ecmwf', model: 'ecmwf_ifs025', name: 'ECMWF IFS', shortName: 'ECMWF', organisation: 'European Centre for Medium-Range Weather Forecasts', description: 'Global ECMWF IFS model at 0.25°, delivered through Open-Meteo. Widely regarded as the most skilful global medium-range model.', color: '#a78bfa', days: 15 },
  { id: 'om-gfs', model: 'gfs_seamless', name: 'NOAA GFS', shortName: 'GFS', organisation: 'NOAA / NCEP (USA)', description: 'NOAA Global Forecast System, blended with HRRR over the US, delivered through Open-Meteo.', color: '#f97316', days: 16 },
  { id: 'om-icon', model: 'icon_seamless', name: 'DWD ICON', shortName: 'ICON', organisation: 'Deutscher Wetterdienst (Germany)', description: 'German Weather Service ICON model (global + EU + D2 nests), delivered through Open-Meteo.', color: '#22c55e', days: 7 },
  { id: 'om-ukmo', model: 'ukmo_seamless', name: 'Met Office UKMO', shortName: 'Met Office', organisation: 'Met Office (UK)', description: 'Met Office Unified Model: global 10 km and UKV 2 km over the British Isles, published as open data and delivered through Open-Meteo. No key required.', color: '#ef4444', days: 7 },
  { id: 'om-meteofrance', model: 'meteofrance_seamless', name: 'Météo-France ARPEGE/AROME', shortName: 'Météo-France', organisation: 'Météo-France', description: 'Météo-France ARPEGE global and AROME high-resolution models, delivered through Open-Meteo.', color: '#3b82f6', days: 4 },
  { id: 'om-gem', model: 'gem_seamless', name: 'Environment Canada GEM', shortName: 'GEM', organisation: 'Environment and Climate Change Canada', description: 'Canadian GEM global and regional models, delivered through Open-Meteo.', color: '#eab308', days: 10 },
  { id: 'om-jma', model: 'jma_seamless', name: 'JMA GSM/MSM', shortName: 'JMA', organisation: 'Japan Meteorological Agency', description: 'Japan Meteorological Agency global and mesoscale models, delivered through Open-Meteo.', color: '#ec4899', days: 11 },
];

export function makeOpenMeteoForecastProvider(m: OmModel): Provider {
  return {
    id: m.id,
    name: m.name,
    shortName: m.shortName,
    organisation: m.organisation,
    kind: 'forecast',
    description: m.description,
    coverage: m.coverage ?? 'Global',
    access: 'Free, no key. Non-commercial use up to 10 000 requests/day (cached here to stay well below).',
    requiresKey: false,
    enabled: true,
    url: 'https://open-meteo.com/en/docs',
    color: m.color,
    supportsForecast: true,
    covers: () => true,
    async forecast(loc, opts) {
      const days = Math.min(opts?.days ?? 10, m.days);
      const params = new URLSearchParams({
        latitude: loc.latitude.toFixed(4),
        longitude: loc.longitude.toFixed(4),
        timezone: 'auto',
        timeformat: 'unixtime',
        forecast_days: String(days),
        models: m.model,
        current: [...Object.values(CURRENT_FIELDS).map(([f]) => f), 'weather_code', 'is_day'].join(','),
        hourly: [...Object.values(OM_HOURLY).map(([f]) => f), 'weather_code', 'is_day'].join(','),
        daily: [...Object.values(OM_DAILY).map(([f]) => f), 'weather_code', 'sunrise', 'sunset'].join(','),
      });
      const [res, updatedAt] = await Promise.all([omFetch<OmResponse>(BASE.openMeteo, '/v1/forecast', params), modelRunTime(m.model)]);
      const ds = parseOpenMeteo(res, {
        providerId: m.id,
        providerName: m.name,
        kind: 'forecast',
        location: loc,
        attribution: OM_ATTRIBUTION,
        notes: [
          m.description,
          'Variables a model does not compute are shown as unavailable rather than filled from another model.',
        ],
      });
      return { ...ds, updatedAt };
    },
  };
}

export const openMeteoArchive: Provider = {
  id: 'om-era5',
  name: 'ERA5 reanalysis (Copernicus)',
  shortName: 'ERA5',
  organisation: 'ECMWF / Copernicus Climate Change Service, via Open-Meteo',
  kind: 'reanalysis',
  description:
    'Hourly reconstruction of past weather from 1940 onwards, combining historical observations with a weather model on a ~25 km grid (ERA5) and ~9 km over land (ERA5-Land). Consistent and gap-free, but it is a model-based estimate, not a station measurement.',
  coverage: 'Global, 1940 to about 5 days ago',
  access: 'Free, no key. Counts towards the same 10 000 requests/day as other Open-Meteo calls; long ranges count as several calls.',
  requiresKey: false,
  enabled: true,
  url: 'https://open-meteo.com/en/docs/historical-weather-api',
  color: '#14b8a6',
  supportsForecast: false,
  historyRange: { from: '1940-01-01', toDaysAgo: 5, resolutions: ['hourly', 'daily'], kind: 'reanalysis' },
  covers: () => true,
  async history(loc, start, end, opts) {
    const params = new URLSearchParams({
      latitude: loc.latitude.toFixed(4),
      longitude: loc.longitude.toFixed(4),
      timezone: 'auto',
      timeformat: 'unixtime',
      start_date: start,
      end_date: end,
    });
    const hourlyFields = [
      ...Object.entries(OM_HOURLY)
        .filter(([k]) => !ARCHIVE_HOURLY_EXCLUDE.has(k))
        .map(([, [f]]) => f),
      ...Object.values(ARCHIVE_HOURLY_EXTRA).map(([f]) => f),
      'weather_code',
    ];
    const dailyFields = [
      ...Object.entries(OM_DAILY)
        .filter(([k]) => !ARCHIVE_DAILY_EXCLUDE.has(k))
        .map(([, [f]]) => f),
      'temperature_2m_mean',
      'weather_code',
      'sunrise',
      'sunset',
    ];
    if (opts.resolution === 'hourly') params.set('hourly', hourlyFields.filter((f) => !f.startsWith('soil_temperature_0cm') && f !== 'soil_moisture_0_to_1cm').join(','));
    params.set('daily', dailyFields.join(','));
    const res = await omFetch<OmResponse>(BASE.openMeteoArchive, '/v1/archive', params, 45000);
    return parseOpenMeteo(res, {
      providerId: 'om-era5',
      providerName: 'ERA5 reanalysis (Copernicus)',
      kind: 'reanalysis',
      location: loc,
      attribution: { text: 'ERA5 / ERA5-Land, Copernicus Climate Change Service, via Open-Meteo.com (CC BY 4.0)', url: 'https://open-meteo.com/en/docs/historical-weather-api' },
      notes: ['Reanalysis: a model-based reconstruction constrained by observations, not station measurements.', 'The most recent ~5 days are not yet available.'],
      archive: true,
    });
  },
};

/* --------------------------- supplementary: air quality & marine --------------------------- */

export async function fetchAirQuality(loc: Location): Promise<WeatherDataset> {
  const fields: Record<string, string> = {
    pm2_5: 'pm2_5',
    pm10: 'pm10',
    nitrogen_dioxide: 'nitrogen_dioxide',
    ozone: 'ozone',
    european_aqi: 'european_aqi',
    us_aqi: 'us_aqi',
  };
  const params = new URLSearchParams({
    latitude: loc.latitude.toFixed(4),
    longitude: loc.longitude.toFixed(4),
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '5',
    current: Object.values(fields).join(','),
    hourly: Object.values(fields).join(','),
  });
  const res = await omFetch<OmResponse>(BASE.openMeteoAir, '/v1/air-quality', params);
  const tz = res.timezone || 'UTC';
  const map = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, [f, same] as [string, Conv]]));
  const hourly = buildBlock(res.hourly, map, false, tz);
  const values: Record<string, number | null> = {};
  if (res.current) for (const [k, f] of Object.entries(fields)) values[k] = (res.current[f] as number | null) ?? null;
  return {
    providerId: 'om-air',
    providerName: 'CAMS air quality',
    kind: 'forecast',
    location: loc,
    timezone: tz,
    fetchedAt: new Date().toISOString(),
    updatedAt: null,
    current: res.current ? { time: toIsoUtc(res.current.time * 1000), values, condition: null, description: null, isDay: null, kind: 'forecast' } : undefined,
    hourly: hourly ? { time: hourly.time, series: hourly.series } : undefined,
    notes: ['Copernicus Atmosphere Monitoring Service (CAMS) model forecast. 11 km over Europe, 40 km globally.'],
    attribution: { text: 'CAMS air quality via Open-Meteo.com (CC BY 4.0)', url: 'https://open-meteo.com/en/docs/air-quality-api' },
  };
}

export async function fetchMarine(loc: Location): Promise<WeatherDataset> {
  const fields: Record<string, string> = {
    wave_height: 'wave_height',
    wave_direction: 'wave_direction',
    wave_period: 'wave_period',
    swell_wave_height: 'swell_wave_height',
    sea_surface_temperature: 'sea_surface_temperature',
  };
  const params = new URLSearchParams({
    latitude: loc.latitude.toFixed(4),
    longitude: loc.longitude.toFixed(4),
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '7',
    current: Object.values(fields).join(','),
    hourly: Object.values(fields).join(','),
  });
  const res = await omFetch<OmResponse>(BASE.openMeteoMarine, '/v1/marine', params);
  const tz = res.timezone || 'UTC';
  const map = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, [f, same] as [string, Conv]]));
  const hourly = buildBlock(res.hourly, map, false, tz);
  const values: Record<string, number | null> = {};
  if (res.current) for (const [k, f] of Object.entries(fields)) values[k] = (res.current[f] as number | null) ?? null;
  const hasAny = Object.values(values).some((x) => x !== null) || Object.keys(hourly?.series ?? {}).length > 0;
  return {
    providerId: 'om-marine',
    providerName: 'Marine forecast',
    kind: 'forecast',
    location: loc,
    timezone: tz,
    fetchedAt: new Date().toISOString(),
    updatedAt: null,
    current: hasAny && res.current ? { time: toIsoUtc(res.current.time * 1000), values, condition: null, description: null, isDay: null, kind: 'forecast' } : undefined,
    hourly: hourly ? { time: hourly.time, series: hourly.series } : undefined,
    notes: hasAny ? ['Wave models (ECMWF WAM, DWD EWAM/GWAM, MeteoFrance MFWAM). Values are for the nearest sea grid cell.'] : ['No marine data for this location (it is too far from the sea).'],
    attribution: { text: 'Marine data via Open-Meteo.com (CC BY 4.0)', url: 'https://open-meteo.com/en/docs/marine-weather-api' },
  };
}

/** Resolve a location's IANA timezone (Open-Meteo answers with timezone=auto). */
export async function lookupTimezone(lat: number, lon: number): Promise<{ timezone: string; elevation?: number }> {
  const params = new URLSearchParams({ latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: 'auto', current: 'temperature_2m', forecast_days: '1' });
  const res = await getJson<OmResponse>(`${BASE.openMeteo}/v1/forecast?${params}`, { timeoutMs: 8000 });
  return { timezone: res.timezone, elevation: res.elevation };
}
