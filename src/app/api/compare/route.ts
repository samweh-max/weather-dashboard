import { NextResponse } from 'next/server';
import { getForecast } from '@/lib/providers';
import { locationFromParams } from '@/lib/server/location';

/** GET /api/compare?providers=a,b,c&lat=..&lon=.. → { results: ProviderResult[] }. One provider failing never fails the rest. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    const loc = await locationFromParams(sp);
    const ids = (sp.get('providers') || 'om-best').split(',').filter(Boolean).slice(0, 12);
    const results = await Promise.all(ids.map((id) => getForecast(id, loc)));
    return NextResponse.json({ location: loc, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
