import { NextResponse } from 'next/server';
import { getForecast } from '@/lib/providers';
import { locationFromParams } from '@/lib/server/location';

/** GET /api/weather?provider=om-best&lat=..&lon=..[&name=&tz=&cc=] → ProviderResult */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    const loc = await locationFromParams(sp);
    const result = await getForecast(sp.get('provider') || 'om-best', loc);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: { providerId: sp.get('provider'), providerName: sp.get('provider'), error: (e as Error).message } }, { status: 400 });
  }
}
