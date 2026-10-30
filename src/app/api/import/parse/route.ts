import { NextResponse } from 'next/server';
import { readWorkbook } from '@/lib/server/xlsx-read';

export const runtime = 'nodejs';
const MAX_BYTES = 40 * 1024 * 1024;

/** POST multipart/form-data with "file" (.xlsx) → { sheets } as plain cell rows for preview & mapping. */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File is larger than 40 MB.' }, { status: 413 });
    const buf = await file.arrayBuffer();
    const sig = new Uint8Array(buf.slice(0, 4));
    if (!(sig[0] === 0x50 && sig[1] === 0x4b)) {
      return NextResponse.json({ error: 'This is not an .xlsx file. Older .xls files must be re-saved as .xlsx (File → Save As → Excel Workbook).' }, { status: 415 });
    }
    const sheets = await readWorkbook(buf);
    return NextResponse.json({ fileName: file.name, sheets });
  } catch (e) {
    return NextResponse.json({ error: `Could not read the workbook: ${(e as Error).message}` }, { status: 400 });
  }
}
