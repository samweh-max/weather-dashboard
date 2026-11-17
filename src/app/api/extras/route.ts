import { NextResponse } from 'next/server';
import { homeStation, homeStationLatest } from '@/lib/providers/campbellon';
import { fetchAirQuality, fetchMarine } from '@/lib/providers/openmeteo';
import { cached } from '@/lib/server/cache';
import { locationFromParams } from '@/lib/server/location';
import type { CurrentConditions, ProviderResult, WeatherDataset } from '@/lib/types';

/** Air quality and marine data: supplementary layers shown alongside any provider. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    const loc = await locationFromParams(sp);
    const key = `${loc.latitude.toFixed(3)},${loc.longitude.toFixed(3)}`;
    const wrap = async (id: string, name: string, f: () => Promise<WeatherDataset>): Promise<ProviderResult> => {
      try {
        return { ok: true, data: await f() };
      } catch (e) {
        return { ok: false, error: { providerId: id, providerName: name, error: (e as Error).message } };
      }
    };
    const [air, marine] = await Promise.all([
      wrap('om-air', 'CAMS air quality', () => cached(`air:${key}`, 30 * 60, () => fetchAirQuality(loc))),
      wrap('om-marine', 'Marine forecast', () => cached(`marine:${key}`, 60 * 60, () => fetchMarine(loc))),
    ]);
    // Home station: only when configured and (if its position is set) near this location.
    let station: { ok: true; current: CurrentConditions | null } | { ok: false; error: string } | null = null;
    if (homeStation.enabled && homeStation.covers(loc)) {
      try {
        station = { ok: true, current: await cached('home-station:latest', 5 * 60, homeStationLatest) };
      } catch (e) {
        station = { ok: false, error: (e as Error).message };
      }
    }
    return NextResponse.json({ air, marine, station });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
