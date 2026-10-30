import { NextResponse } from 'next/server';
import { buildWorkbook, type ExportRequest } from '@/lib/server/export';
import { getVariable } from '@/lib/variables';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** POST ExportRequest → .xlsx download. */
export async function POST(req: Request) {
  let body: ExportRequest;
  try {
    body = (await req.json()) as ExportRequest;
    if (!body.location || !Number.isFinite(body.location.latitude) || !Number.isFinite(body.location.longitude)) throw new Error('A location is required.');
    if (!DATE.test(body.start) || !DATE.test(body.end) || body.start > body.end) throw new Error('Invalid date range.');
    if (!body.sources?.length) throw new Error('Choose at least one source.');
    if (!body.variables?.length) throw new Error('Choose at least one variable.');
    body.variables = body.variables.filter((v) => getVariable(v));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    const { buffer, failures, datasets } = await buildWorkbook(body);
    if (!datasets) return NextResponse.json({ error: `No data could be fetched. ${failures.map((f) => `${f.source}: ${f.error}`).join('; ')}` }, { status: 502 });
    const safe = (body.location.name || 'location').replace(/[^\w\-]+/g, '_').slice(0, 40);
    const filename = `weather_${safe}_${body.start}_${body.end}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Export-Failures': encodeURIComponent(JSON.stringify(failures)),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
