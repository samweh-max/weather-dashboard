import 'server-only';
import { cached } from '../server/cache';
import type { Location, ProviderResult, WeatherDataset } from '../types';
import { metOffice } from './metoffice';
import { metno } from './metno';
import { nwsForecast, nwsObservations } from './nws';
import { makeOpenMeteoForecastProvider, OM_MODELS, openMeteoArchive } from './openmeteo';
import type { Provider, ProviderInfo } from './types';

/**
 * All providers. To add a new source, implement `Provider` in its own file and
 * add it here; the UI, comparison, history and export pick it up automatically.
 */
export const PROVIDERS: Provider[] = [
  ...OM_MODELS.map(makeOpenMeteoForecastProvider),
  metno,
  nwsForecast,
  metOffice,
  openMeteoArchive,
  nwsObservations,
];

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providerInfo(p: Provider, loc?: Location): ProviderInfo & { available: boolean; unavailableReason?: string } {
  const { covers: _c, forecast: _f, history: _h, ...info } = p;
  void info;
  void _c;
  void _f;
  void _h;
  let available = p.enabled;
  let unavailableReason: string | undefined = p.enabled ? undefined : 'Requires an API key (see Sources page).';
  if (available && loc && !p.covers(loc)) {
    available = false;
    unavailableReason = `Not available for this location (${p.coverage}).`;
  }
  return { ...info, available, unavailableReason };
}

const roundKey = (loc: Location) => `${loc.latitude.toFixed(3)},${loc.longitude.toFixed(3)}`;

function errorResult(p: Provider, e: unknown): ProviderResult {
  return { ok: false, error: { providerId: p.id, providerName: p.name, error: (e as Error)?.message || String(e) } };
}

/** Fetch a forecast, cached for 20 minutes. Never throws: failures come back as `ok: false`. */
export async function getForecast(providerId: string, loc: Location): Promise<ProviderResult> {
  const p = getProvider(providerId);
  if (!p) return { ok: false, error: { providerId, providerName: providerId, error: 'Unknown provider' } };
  if (!p.forecast || !p.supportsForecast) return errorResult(p, new Error('This source does not provide forecasts.'));
  if (!p.enabled) return errorResult(p, new Error(p.access));
  if (!p.covers(loc)) return errorResult(p, new Error(`Not available for this location (${p.coverage}).`));
  try {
    const data = await cached<WeatherDataset>(`fc:${p.id}:${roundKey(loc)}`, 20 * 60, () => p.forecast!(loc, { days: 10 }));
    return { ok: true, data };
  } catch (e) {
    return errorResult(p, e);
  }
}

/** Fetch historical data. Long-past ranges are cached for a week, recent ones for 3 hours. */
export async function getHistory(providerId: string, loc: Location, start: string, end: string, resolution: 'hourly' | 'daily'): Promise<ProviderResult> {
  const p = getProvider(providerId);
  if (!p) return { ok: false, error: { providerId, providerName: providerId, error: 'Unknown provider' } };
  if (!p.history) return errorResult(p, new Error('This source does not provide historical data.'));
  if (!p.covers(loc)) return errorResult(p, new Error(`Not available for this location (${p.coverage}).`));
  const recent = Date.now() - Date.parse(`${end}T00:00:00Z`) < 10 * 86400_000;
  try {
    const data = await cached<WeatherDataset>(`hist:${p.id}:${roundKey(loc)}:${start}:${end}:${resolution}`, recent ? 3 * 3600 : 7 * 86400, () =>
      p.history!(loc, start, end, { resolution }),
    );
    return { ok: true, data };
  } catch (e) {
    return errorResult(p, e);
  }
}

export type { Provider, ProviderInfo };
