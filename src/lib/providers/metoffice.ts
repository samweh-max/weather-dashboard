import 'server-only';
import { enrichDataset } from '../calc';
import { MET_OFFICE_CODES } from '../conditions';
import { BASE, getJson } from '../server/http';
import type { Condition, Location, Series, WeatherDataset } from '../types';
import type { Provider } from './types';

/**
 * Met Office Weather DataHub — Site Specific (global spot) forecasts.
 * Free tier: 360 calls/day, but needs a (free) account and API key, so this
 * provider is optional and only enabled when MET_OFFICE_API_KEY is set.
 *
 * Note: Met Office model data is ALSO available without any key through the
 * "Met Office UKMO" provider (Open-Meteo republishes the Met Office open data).
 */

interface MoStep {
  time: string;
  screenTemperature?: number;
  feelsLikeTemperature?: number;
  screenDewPointTemperature?: number;
  screenRelativeHumidity?: number;
  windSpeed10m?: number;
  windDirectionFrom10m?: number;
  windGustSpeed10m?: number;
  max10mWindGust?: number;
  mslp?: number;
  visibility?: number;
  uvIndex?: number;
  probOfPrecipitation?: number;
  totalPrecipAmount?: number;
  totalSnowAmount?: number;
  significantWeatherCode?: number;
}
export interface MoResponse {
  features: { properties: { modelRunDate?: string; timeSeries: MoStep[]; location?: { name?: string } } }[];
}

const num = (x: number | undefined) => (x === undefined || x === null || !Number.isFinite(x) || x === -99 ? null : x);

export function parseMetOffice(res: MoResponse, loc: Location, tz: string): WeatherDataset {
  const props = res.features?.[0]?.properties;
  if (!props) throw new Error('Met Office response contained no forecast.');
  const ts = props.timeSeries;
  const time = ts.map((s) => s.time.replace(/T(\d{2}):(\d{2})Z$/, 'T$1:$2:00Z'));
  const col = (f: (s: MoStep) => number | null): Series => ({ values: ts.map(f), origin: 'provider' });
  const series: Record<string, Series> = {
    temperature: col((s) => num(s.screenTemperature)),
    apparent_temperature: col((s) => num(s.feelsLikeTemperature)),
    dew_point: col((s) => num(s.screenDewPointTemperature)),
    relative_humidity: col((s) => num(s.screenRelativeHumidity)),
    wind_speed: col((s) => (num(s.windSpeed10m) === null ? null : (s.windSpeed10m as number) * 3.6)),
    wind_direction: col((s) => num(s.windDirectionFrom10m)),
    wind_gusts: col((s) => {
      const g = num(s.windGustSpeed10m) ?? num(s.max10mWindGust);
      return g === null ? null : g * 3.6;
    }),
    pressure_msl: col((s) => (num(s.mslp) === null ? null : (s.mslp as number) / 100)),
    visibility: col((s) => (num(s.visibility) === null ? null : (s.visibility as number) / 1000)),
    uv_index: col((s) => num(s.uvIndex)),
    precipitation_probability: col((s) => num(s.probOfPrecipitation)),
    precipitation: col((s) => num(s.totalPrecipAmount)),
    snowfall: col((s) => (num(s.totalSnowAmount) === null ? null : (s.totalSnowAmount as number) / 10)),
  };
  for (const k of Object.keys(series)) if (!series[k].values.some((x) => x !== null)) delete series[k];
  const conditions: (Condition | null)[] = ts.map((s) => (s.significantWeatherCode === undefined ? null : (MET_OFFICE_CODES[s.significantWeatherCode]?.[1] ?? null)));
  const descriptions = ts.map((s) => (s.significantWeatherCode === undefined ? null : (MET_OFFICE_CODES[s.significantWeatherCode]?.[0] ?? null)));
  const hourly = { time, series, conditions, descriptions };
  const nowIdx = Math.max(0, time.findIndex((t) => Date.parse(t) >= Date.now() - 3600_000));
  return enrichDataset({
    providerId: 'metoffice',
    providerName: 'Met Office DataHub',
    kind: 'forecast',
    location: loc,
    timezone: tz,
    fetchedAt: new Date().toISOString(),
    updatedAt: props.modelRunDate ?? null,
    current: {
      time: time[nowIdx],
      values: Object.fromEntries(Object.entries(series).map(([k, s]) => [k, s.values[nowIdx]])),
      condition: conditions[nowIdx],
      description: descriptions[nowIdx],
      isDay: ts[nowIdx]?.significantWeatherCode === 0 ? false : null,
      kind: 'forecast',
      sourceNote: 'Nearest hourly forecast step, not a station observation.',
    },
    hourly,
    notes: ['Met Office global spot forecast (post-processed Unified Model), hourly for ~48 hours.'],
    attribution: { text: 'Contains Met Office data © Crown copyright', url: 'https://datahub.metoffice.gov.uk/' },
  });
}

export const metOffice: Provider = {
  id: 'metoffice',
  name: 'Met Office DataHub (Site Specific)',
  shortName: 'Met Office DH',
  organisation: 'Met Office (UK)',
  kind: 'forecast',
  description: 'Post-processed Met Office spot forecasts (the same product behind the Met Office app). Optional: needs a free DataHub API key.',
  coverage: 'Global, hourly for ~2 days',
  access:
    'Free "Site Specific" plan after registering at datahub.metoffice.gov.uk: 360 calls/day. Set MET_OFFICE_API_KEY on the server to enable. Without a key, use the keyless "Met Office UKMO" model provider instead.',
  requiresKey: true,
  enabled: !!process.env.MET_OFFICE_API_KEY,
  url: 'https://datahub.metoffice.gov.uk/',
  color: '#dc2626',
  supportsForecast: true,
  covers: () => !!process.env.MET_OFFICE_API_KEY,
  async forecast(loc) {
    const key = process.env.MET_OFFICE_API_KEY;
    if (!key) throw new Error('Met Office DataHub needs a free API key (MET_OFFICE_API_KEY).');
    const params = new URLSearchParams({ latitude: loc.latitude.toFixed(4), longitude: loc.longitude.toFixed(4), includeLocationName: 'true', excludeParameterMetadata: 'true' });
    const res = await getJson<MoResponse>(`${BASE.metOffice}/sitespecific/v0/point/hourly?${params}`, { headers: { apikey: key } });
    return parseMetOffice(res, loc, loc.timezone || 'UTC');
  },
};
