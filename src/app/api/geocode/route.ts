import { NextResponse } from 'next/server';
import { searchLocations } from '@/lib/server/location';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  try {
    return NextResponse.json({ results: await searchLocations(q) });
  } catch (e) {
    return NextResponse.json({ results: [], error: (e as Error).message }, { status: 502 });
  }
}
