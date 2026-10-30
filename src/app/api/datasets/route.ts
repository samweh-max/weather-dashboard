import { NextResponse } from 'next/server';
import { listDatasets, saveDataset } from '@/lib/server/datasets';
import { getVariable } from '@/lib/variables';
import type { ImportedDatasetMeta } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json({ datasets: listDatasets() });
  } catch (e) {
    return NextResponse.json({ datasets: [], error: (e as Error).message }, { status: 500 });
  }
}

interface Body {
  meta: Omit<ImportedDatasetMeta, 'id' | 'createdAt'>;
  data: { time: string[]; series: Record<string, (number | null)[]> };
}

/** Save a dataset the browser has already parsed, mapped and validated. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { meta, data } = body;
    if (!meta?.name?.trim()) throw new Error('A dataset name is required.');
    if (!Array.isArray(data?.time) || !data.time.length) throw new Error('The dataset has no rows.');
    if (meta.resolution !== 'hourly' && meta.resolution !== 'daily') throw new Error('Resolution must be hourly or daily.');
    const timeRe = meta.resolution === 'daily' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    if (!data.time.every((t) => timeRe.test(t))) throw new Error('Timestamps are not in the expected format.');
    for (const [k, vals] of Object.entries(data.series)) {
      if (!getVariable(k)) throw new Error(`Unknown variable "${k}".`);
      if (vals.length !== data.time.length) throw new Error(`Series "${k}" length does not match the timestamps.`);
      if (!vals.every((v) => v === null || (typeof v === 'number' && Number.isFinite(v)))) throw new Error(`Series "${k}" contains non-numeric values.`);
    }
    const saved = saveDataset({ ...meta, name: meta.name.trim(), variables: Object.keys(data.series), rowCount: data.time.length, start: data.time[0], end: data.time[data.time.length - 1] }, data);
    return NextResponse.json({ dataset: saved });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
