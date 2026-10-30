import { NextResponse } from 'next/server';
import { getHistory } from '@/lib/providers';
import { locationFromParams } from '@/lib/server/location';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/history?provider=om-era5&lat=..&lon=..&start=YYYY-MM-DD&end=YYYY-MM-DD&res=daily|hourly */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  try {
    const loc = await locationFromParams(sp);
    const start = sp.get('start') ?? '';
    const end = sp.get('end') ?? '';
    if (!DATE.test(start) || !DATE.test(end) || start > end) throw new Error('start and end must be YYYY-MM-DD with start ≤ end.');
    const res = sp.get('res') === 'hourly' ? 'hourly' : 'daily';
    const days = (Date.parse(end) - Date.parse(start)) / 86400000;
    if (res === 'hourly' && days > 366 * 3) throw new Error('Hourly ranges are limited to 3 years per request. Use daily resolution for longer periods.');
    if (days > 366 * 90) throw new Error('Ranges are limited to 90 years.');
    const result = await getHistory(sp.get('provider') || 'om-era5', loc, start, end, res);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: { providerId: sp.get('provider'), providerName: sp.get('provider'), error: (e as Error).message } }, { status: 400 });
  }
}
