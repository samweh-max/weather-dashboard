import 'server-only';
import ExcelJS from 'exceljs';
import { describe, expectedSteps, periodSummaries } from '../stats';
import { localDate, tzOffsetSeconds } from '../time';
import type { Location, TimeBlock, WeatherDataset } from '../types';
import { convertForDisplay, displayUnit, type UnitPrefs } from '../units';
import { CATEGORY_LABELS, getVariable, VARIABLES } from '../variables';
import { getForecast, getHistory, getProvider } from '../providers';
import { datasetAsWeather } from './datasets';

export interface ExportRequest {
  location: Location;
  start: string;
  end: string;
  /** Provider ids, or "import:<datasetId>" for imported datasets. */
  sources: string[];
  /** 'auto' = forecast for forecast providers, history for archive/observation providers. */
  dataType: 'auto' | 'forecast' | 'history';
  resolution: 'hourly' | 'daily' | 'both';
  variables: string[];
  units: UnitPrefs;
  includeStats: boolean;
  includeComparison: boolean;
}

export interface ExportFailure {
  source: string;
  error: string;
}

const KIND_LABEL: Record<string, string> = {
  forecast: 'Forecast',
  observation: 'Observation',
  reanalysis: 'Reanalysis (modelled past weather)',
  imported: 'User-imported',
};

/** Fetch every requested source; failures are reported, not fatal. */
export async function gatherSources(req: ExportRequest): Promise<{ datasets: WeatherDataset[]; failures: ExportFailure[] }> {
  const datasets: WeatherDataset[] = [];
  const failures: ExportFailure[] = [];
  const histRes = req.resolution === 'hourly' || req.resolution === 'both' ? 'hourly' : 'daily';
  await Promise.all(
    req.sources.map(async (src) => {
      if (src.startsWith('import:')) {
        const ds = datasetAsWeather(src.slice(7), req.start, req.end);
        if (ds) datasets.push(ds);
        else failures.push({ source: src, error: 'Imported dataset not found.' });
        return;
      }
      const p = getProvider(src);
      if (!p) {
        failures.push({ source: src, error: 'Unknown source.' });
        return;
      }
      const wantHistory = req.dataType === 'history' || (req.dataType === 'auto' && !p.supportsForecast);
      const r = wantHistory && p.history ? await getHistory(src, req.location, req.start, req.end, histRes) : await getForecast(src, req.location);
      if (r.ok) datasets.push(r.data);
      else failures.push({ source: p.name, error: r.error.error });
    }),
  );
  // keep the order the user chose
  datasets.sort((a, b) => indexOfSource(req.sources, a.providerId) - indexOfSource(req.sources, b.providerId));
  return { datasets, failures };
}

const indexOfSource = (sources: string[], id: string) => {
  const i = sources.indexOf(id);
  return i < 0 ? 999 : i;
};

/** Restrict a block to the requested local date range. */
function sliceBlock(block: TimeBlock | undefined, start: string, end: string, tz: string, daily: boolean): TimeBlock | undefined {
  if (!block) return undefined;
  const idx: number[] = [];
  block.time.forEach((t, i) => {
    const d = daily ? t : localDate(t, tz);
    if (d >= start && d <= end) idx.push(i);
  });
  const series: TimeBlock['series'] = {};
  for (const [k, s] of Object.entries(block.series)) series[k] = { ...s, values: idx.map((i) => s.values[i]) };
  return { time: idx.map((i) => block.time[i]), series, conditions: block.conditions && idx.map((i) => block.conditions![i]), descriptions: block.descriptions && idx.map((i) => block.descriptions![i]) };
}

/** A Date whose UTC fields show the local wall-clock time, so Excel displays local time. */
function excelLocal(iso: string, tz: string): Date {
  const ms = Date.parse(iso);
  return new Date(ms + tzOffsetSeconds(ms, tz) * 1000);
}
const excelUtc = (iso: string) => new Date(Date.parse(iso));
const excelDay = (date: string) => new Date(`${date}T00:00:00Z`);

function numFmtFor(varId: string): string {
  // Display format only: the stored value keeps full precision.
  const def = getVariable(varId);
  switch (def?.quantity) {
    case 'percent':
    case 'direction':
      return '0';
    case 'soilMoisture':
      return '0.000';
    case 'pressure':
      return '0.0#';
    default:
      return '0.0#';
  }
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };

function styleHeader(row: ExcelJS.Row) {
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 32;
}

function colLabel(varId: string, units: UnitPrefs) {
  const def = getVariable(varId);
  if (!def) return varId;
  const u = displayUnit(def.quantity, def.unit, units);
  return u ? `${def.label} (${u})` : def.label;
}

function convert(varId: string, v: number | null, units: UnitPrefs): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const def = getVariable(varId);
  return def ? convertForDisplay(v, def.quantity, units) : v;
}

function variablesIn(datasets: WeatherDataset[], which: 'hourly' | 'daily', wanted: string[]): string[] {
  const present = new Set<string>();
  for (const ds of datasets) for (const k of Object.keys(ds[which]?.series ?? {})) present.add(k);
  return wanted.filter((v) => present.has(v));
}

function addDataSheet(wb: ExcelJS.Workbook, name: string, datasets: WeatherDataset[], which: 'hourly' | 'daily', vars: string[], req: ExportRequest) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  const fixed = which === 'hourly' ? ['Time (local)', 'Time (UTC)', 'Timezone', 'Source', 'Data type', 'Conditions'] : ['Date', 'Source', 'Data type', 'Conditions'];
  const headers = [...fixed, ...vars.map((v) => colLabel(v, req.units))];
  ws.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: i < fixed.length ? (i < 2 ? 18 : 16) : Math.max(12, Math.min(28, h.length + 2)) }));
  styleHeader(ws.getRow(1));
  for (const ds of datasets) {
    const block = ds[which];
    if (!block) continue;
    for (let i = 0; i < block.time.length; i++) {
      const t = block.time[i];
      const cond = block.descriptions?.[i] ?? block.conditions?.[i] ?? null;
      const base =
        which === 'hourly' ? [excelLocal(t, ds.timezone), excelUtc(t), ds.timezone, ds.providerName, KIND_LABEL[ds.kind], cond] : [excelDay(t), ds.providerName, KIND_LABEL[ds.kind], cond];
      const values = vars.map((v) => convert(v, block.series[v]?.values[i] ?? null, req.units));
      ws.addRow([...base, ...values]);
    }
  }
  // formats
  if (which === 'hourly') {
    ws.getColumn(1).numFmt = 'yyyy-mm-dd hh:mm';
    ws.getColumn(2).numFmt = 'yyyy-mm-dd hh:mm';
  } else ws.getColumn(1).numFmt = 'yyyy-mm-dd';
  vars.forEach((v, j) => (ws.getColumn(fixed.length + j + 1).numFmt = numFmtFor(v)));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  return ws;
}

function addComparisonSheet(wb: ExcelJS.Workbook, datasets: WeatherDataset[], which: 'hourly' | 'daily', vars: string[], req: ExportRequest) {
  const ws = wb.addWorksheet(`Comparison (${which})`, { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
  const tz = datasets[0]?.timezone ?? 'UTC';
  const times = [...new Set(datasets.flatMap((d) => d[which]?.time ?? []))].sort();
  const index = datasets.map((d) => new Map((d[which]?.time ?? []).map((t, i) => [t, i])));
  // Two header rows: variable group, then source
  const top: (string | null)[] = [which === 'hourly' ? 'Time (local)' : 'Date'];
  const sub: string[] = [''];
  const cols: { v: string; d: number | 'spread' }[] = [];
  for (const v of vars) {
    const has = datasets.map((d) => !!d[which]?.series[v]);
    datasets.forEach((d, di) => {
      top.push(colLabel(v, req.units));
      sub.push(has[di] ? d.providerName : `${d.providerName} (not available)`);
      cols.push({ v, d: di });
    });
    if (datasets.length > 1) {
      top.push(colLabel(v, req.units));
      sub.push('Spread (max − min)');
      cols.push({ v, d: 'spread' });
    }
  }
  ws.addRow(top);
  ws.addRow(sub);
  styleHeader(ws.getRow(1));
  styleHeader(ws.getRow(2));
  // merge variable headers
  let c = 2;
  for (let k = 0; k < vars.length; k++) {
    const span = datasets.length + (datasets.length > 1 ? 1 : 0);
    if (span > 1) ws.mergeCells(1, c, 1, c + span - 1);
    c += span;
  }
  for (const t of times) {
    const row: (Date | number | null)[] = [which === 'hourly' ? excelLocal(t, tz) : excelDay(t)];
    const cache: Record<string, (number | null)[]> = {};
    for (const col of cols) {
      if (col.d === 'spread') {
        const xs = (cache[col.v] ?? []).filter((x): x is number => x !== null);
        row.push(xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : null);
      } else {
        const ds = datasets[col.d];
        const i = index[col.d].get(t);
        const val = i === undefined ? null : convert(col.v, ds[which]?.series[col.v]?.values[i] ?? null, req.units);
        (cache[col.v] ??= []).push(val);
        row.push(val);
      }
    }
    ws.addRow(row);
  }
  ws.getColumn(1).numFmt = which === 'hourly' ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd';
  ws.getColumn(1).width = 18;
  cols.forEach((col, j) => {
    const column = ws.getColumn(j + 2);
    column.numFmt = numFmtFor(col.v);
    column.width = 16;
    if (col.d === 'spread') column.font = { italic: true, color: { argb: 'FF9A3412' } };
  });
  return ws;
}

function addStatsSheets(wb: ExcelJS.Workbook, datasets: WeatherDataset[], req: ExportRequest) {
  const ws = wb.addWorksheet('Statistics', { views: [{ state: 'frozen', ySplit: 1 }] });
  const headers = ['Source', 'Data type', 'Resolution', 'Variable', 'Unit', 'Values', 'Expected', 'Completeness', 'Minimum', 'Min time', 'Maximum', 'Max time', 'Mean', 'Std deviation', 'Total'];
  ws.addRow(headers);
  styleHeader(ws.getRow(1));
  const monthly: (string | number | null)[][] = [];
  const annual: (string | number | null)[][] = [];
  const multiMonth = req.start.slice(0, 7) !== req.end.slice(0, 7);
  for (const ds of datasets) {
    for (const which of ['hourly', 'daily'] as const) {
      if (req.resolution !== 'both' && req.resolution !== which) continue;
      const block = ds[which];
      if (!block) continue;
      for (const v of req.variables) {
        const s = block.series[v];
        if (!s) continue;
        const def = getVariable(v);
        const unit = def ? displayUnit(def.quantity, def.unit, req.units) : '';
        const vals = s.values.map((x) => convert(v, x, req.units));
        const expected = ds.kind === 'forecast' ? block.time.length : expectedSteps(req.start, req.end, which);
        const st = describe(v, block.time, vals, expected);
        const fmtTime = (t: string | null) => (t ? (which === 'hourly' ? excelLocal(t, ds.timezone) : excelDay(t)) : null);
        ws.addRow([ds.providerName, KIND_LABEL[ds.kind], which, def?.label ?? v, unit, st.count, st.expected, st.completeness, st.min, fmtTime(st.minTime), st.max, fmtTime(st.maxTime), st.mean, st.std, st.total]);
        if (multiMonth && (which === 'daily' || !ds.daily?.series[v])) {
          for (const p of periodSummaries(v, block.time, vals, which, 'month', ds.timezone))
            monthly.push([ds.providerName, def?.label ?? v, unit, p.period, p.aggregation, p.value, p.min, p.max, p.count, p.expected, p.completeness]);
          for (const p of periodSummaries(v, block.time, vals, which, 'year', ds.timezone))
            annual.push([ds.providerName, def?.label ?? v, unit, p.period, p.aggregation, p.value, p.min, p.max, p.count, p.expected, p.completeness]);
        }
      }
    }
  }
  ws.getColumn(8).numFmt = '0.0%';
  ws.getColumn(10).numFmt = 'yyyy-mm-dd hh:mm';
  ws.getColumn(12).numFmt = 'yyyy-mm-dd hh:mm';
  for (const c of [9, 11, 13, 14, 15]) ws.getColumn(c).numFmt = '0.0#';
  ws.columns.forEach((c, i) => (c.width = i < 4 ? 22 : 14));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  const periodHeaders = ['Source', 'Variable', 'Unit', 'Period', 'Summary', 'Value', 'Minimum', 'Maximum', 'Values', 'Expected', 'Completeness'];
  for (const [name, rows] of [
    ['Monthly summary', monthly],
    ['Annual summary', annual],
  ] as const) {
    if (!rows.length) continue;
    const ps = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ps.addRow(periodHeaders);
    styleHeader(ps.getRow(1));
    rows.forEach((r) => ps.addRow(r));
    for (const c of [6, 7, 8]) ps.getColumn(c).numFmt = '0.0#';
    ps.getColumn(11).numFmt = '0.0%';
    ps.columns.forEach((c, i) => (c.width = i < 2 ? 24 : 13));
    ps.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: periodHeaders.length } };
  }
}

function addVariablesSheet(wb: ExcelJS.Workbook, datasets: WeatherDataset[], req: ExportRequest) {
  const ws = wb.addWorksheet('Variables');
  const headers = ['Variable', 'Id', 'Category', 'Unit (exported)', 'Canonical unit', 'Daily summary method', 'Description', ...datasets.map((d) => d.providerName)];
  ws.addRow(headers);
  styleHeader(ws.getRow(1));
  for (const v of req.variables) {
    const def = getVariable(v);
    if (!def) continue;
    const perSource = datasets.map((d) => {
      const s = d.hourly?.series[v] ?? d.daily?.series[v];
      if (!s) return 'Not available';
      return s.origin === 'calculated' ? `Calculated by this app${s.note ? `: ${s.note}` : ''}` : `From provider${s.note ? `: ${s.note}` : ''}`;
    });
    ws.addRow([def.label, def.id, CATEGORY_LABELS[def.category], displayUnit(def.quantity, def.unit, req.units), def.unit, def.aggregation, def.description, ...perSource]);
  }
  ws.columns.forEach((c, i) => (c.width = i === 6 ? 60 : i >= 7 ? 40 : 18));
  ws.eachRow((r, n) => n > 1 && (r.alignment = { wrapText: true, vertical: 'top' }));
}

function addAboutSheet(wb: ExcelJS.Workbook, datasets: WeatherDataset[], failures: ExportFailure[], req: ExportRequest) {
  const ws = wb.addWorksheet('About');
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 80;
  const title = ws.addRow(['Weather data export']);
  title.font = { bold: true, size: 16 };
  ws.addRow([]);
  const loc = req.location;
  const rows: [string, string | number | Date][] = [
    ['Location', [loc.name, loc.region].filter(Boolean).join(', ')],
    ['Latitude', loc.latitude],
    ['Longitude', loc.longitude],
    ['Elevation (m)', loc.elevation ?? ''],
    ['Timezone', datasets[0]?.timezone ?? loc.timezone ?? 'UTC'],
    ['Requested period', `${req.start} to ${req.end}`],
    ['Resolution', req.resolution],
    ['Generated', new Date()],
    [
      'Units',
      `Temperature ${req.units.temperature === 'F' ? '°F' : '°C'}; wind ${displayUnit('speed', '', req.units)}; precipitation ${displayUnit('precipitation', '', req.units)}; pressure ${displayUnit('pressure', '', req.units)}; visibility ${displayUnit('distance', '', req.units)}`,
    ],
    ['Time columns', '"Time (local)" is the location\'s local time; "Time (UTC)" is the same instant in UTC. Daily rows use the local calendar date.'],
    ['Missing values', 'Empty cells mean the source did not provide a value. Nothing is filled in or interpolated.'],
    ['Precision', 'Numbers are stored at full precision; cell formats only control how many decimals are displayed.'],
  ];
  for (const [k, v] of rows) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    r.alignment = { wrapText: true, vertical: 'top' };
  }
  ws.getCell(`B${ws.rowCount - 4}`).numFmt = 'yyyy-mm-dd hh:mm';
  ws.addRow([]);
  const h = ws.addRow(['Sources']);
  h.font = { bold: true, size: 13 };
  const sh = ws.addRow(['Source', 'Data type', 'Fetched', 'Provider updated', 'Attribution', 'Notes']);
  styleHeader(sh);
  for (const ds of datasets) {
    const r = ws.addRow([ds.providerName, KIND_LABEL[ds.kind], new Date(ds.fetchedAt), ds.updatedAt ? new Date(ds.updatedAt) : 'Not published', `${ds.attribution.text}${ds.attribution.url ? ` (${ds.attribution.url})` : ''}`, ds.notes.join(' ')]);
    r.getCell(3).numFmt = 'yyyy-mm-dd hh:mm "UTC"';
    r.getCell(4).numFmt = 'yyyy-mm-dd hh:mm "UTC"';
    r.alignment = { wrapText: true, vertical: 'top' };
  }
  for (const f of failures) {
    const r = ws.addRow([f.source, 'NOT INCLUDED', '', '', '', `Could not be fetched: ${f.error}`]);
    r.font = { color: { argb: 'FFB91C1C' } };
  }
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 40;
  ws.getColumn(6).width = 80;
  ws.addRow([]);
  const lg = ws.addRow(['Data types']);
  lg.font = { bold: true, size: 13 };
  for (const [k, v] of [
    ['Forecast', 'Model prediction for the future (or the current model step).'],
    ['Observation', 'Measured by a weather station.'],
    ['Reanalysis', 'Model-based reconstruction of past weather constrained by observations (e.g. ERA5). Not a direct measurement.'],
    ['User-imported', 'Data you imported from a spreadsheet.'],
    ['Calculated', 'Derived by this app from provider values (e.g. heat index, daily mean, growing degree days); see the Variables sheet.'],
  ]) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  }
}

export async function buildWorkbook(req: ExportRequest): Promise<{ buffer: Buffer; failures: ExportFailure[]; datasets: number }> {
  const { datasets: raw, failures } = await gatherSources(req);
  const datasets = raw.map((ds) => ({
    ...ds,
    hourly: sliceBlock(ds.hourly, req.start, req.end, ds.timezone, false),
    daily: sliceBlock(ds.daily, req.start, req.end, ds.timezone, true),
  }));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Weather Dashboard';
  wb.created = new Date();
  addAboutSheet(wb, datasets, failures, req);
  const ordered = VARIABLES.map((v) => v.id).filter((id) => req.variables.includes(id));
  const want = { ...req, variables: ordered };
  for (const which of ['hourly', 'daily'] as const) {
    if (req.resolution !== 'both' && req.resolution !== which) continue;
    const vars = variablesIn(datasets, which, ordered);
    if (!vars.length) continue;
    addDataSheet(wb, which === 'hourly' ? 'Hourly data' : 'Daily data', datasets, which, vars, want);
  }
  if (req.includeComparison && datasets.length > 1) {
    const which = req.resolution === 'hourly' ? 'hourly' : 'daily';
    const vars = variablesIn(datasets, which, ordered);
    if (vars.length) addComparisonSheet(wb, datasets, which, vars, want);
  }
  if (req.includeStats) addStatsSheets(wb, datasets, want);
  addVariablesSheet(wb, datasets, want);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, failures, datasets: datasets.length };
}
