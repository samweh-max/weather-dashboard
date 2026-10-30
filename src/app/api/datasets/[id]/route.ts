import { NextResponse } from 'next/server';
import { datasetAsWeather, deleteDataset } from '@/lib/server/datasets';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const ds = datasetAsWeather(id, sp.get('start') || undefined, sp.get('end') || undefined);
  if (!ds) return NextResponse.json({ ok: false, error: { providerId: id, providerName: id, error: 'Dataset not found' } }, { status: 404 });
  return NextResponse.json({ ok: true, data: ds });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ deleted: deleteDataset(id) });
}
