import 'server-only';
import ExcelJS from 'exceljs';
import type { Cell, SheetData } from '../import';

const MAX_ROWS = 200_000;

function normaliseCell(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v;
  // ExcelJS returns date cells as JS Dates whose UTC fields equal the wall-clock value in the sheet
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : { date: v.toISOString().slice(0, 19) };
  if (typeof v === 'object') {
    if ('result' in v) return normaliseCell((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
  }
  return String(v);
}

/** Read every worksheet of an .xlsx file into plain rows of cells. */
export async function readWorkbook(buffer: ArrayBuffer): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets: SheetData[] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    let total = 0;
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      total = rowNumber;
      if (rowNumber > MAX_ROWS) return;
      const values = row.values as ExcelJS.CellValue[]; // 1-based
      const out: Cell[] = [];
      for (let c = 1; c < values.length; c++) out.push(normaliseCell(values[c]));
      while (rows.length < rowNumber - 1) rows.push([]);
      rows.push(out);
    });
    sheets.push({ name: ws.name, rows, totalRows: total, truncated: total > MAX_ROWS });
  });
  return sheets;
}
