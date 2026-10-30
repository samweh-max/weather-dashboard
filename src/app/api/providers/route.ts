import { NextResponse } from 'next/server';
import { PROVIDERS, providerInfo } from '@/lib/providers';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get('lat'));
  const lon = Number(sp.get('lon'));
  const loc = sp.has('lat') && Number.isFinite(lat) && Number.isFinite(lon) ? { name: '', latitude: lat, longitude: lon, countryCode: sp.get('cc') || undefined } : undefined;
  return NextResponse.json({ providers: PROVIDERS.map((p) => providerInfo(p, loc)) });
}
