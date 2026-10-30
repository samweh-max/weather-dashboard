/**
 * Spreadsheet import: header/timestamp detection, column → variable mapping,
 * unit conversion and validation. Pure functions so they run in the browser
 * (for the live preview) and in tests.
 */
import { getSourceUnit, guessSourceUnit } from './units';
import { aggregate } from './calc';
import { VARIABLES, getVariable } from './variables';
import { toIsoUtc, zonedToUtc } from './time';

/** A cell after server-side parsing: number, text, a wall-clock date ("2024-01-01T13:00:00"), or empty. */
export type Cell = number | string | boolean | { date: string } | null;

export interface SheetData {
  name: string;
  rows: Cell[][];
  totalRows: number;
  truncated: boolean;
}

export type DateOrder = 'YMD' | 'DMY' | 'MDY';

export interface ColumnMapping {
  column: number;
  header: string;
  /** Variable id, or '' to ignore the column. */
  variable: string;
  /** SOURCE_UNITS id. */
  unit: string;
}

export interface ImportConfig {
  headerRow: number; // 0-based index into rows
  timeColumn: number;
  /** Optional separate time-of-day column. */
  timeOfDayColumn: number | null;
  dateOrder: DateOrder;
  /** Timezone the spreadsheet timestamps are written in. */
  timezone: string;
  resolution: 'auto' | 'hourly' | 'daily';
  mappings: ColumnMapping[];
  /** Extra values treated as missing, e.g. "-9999". */
  missingMarkers: string[];
  excludeImplausible: boolean;
}

/* ------------------------------- variable aliases ------------------------------- */

const ALIASES: Record<string, string[]> = {
  temperature: ['temperature', 'temp', 'air temp', 'air temperature', 't2m', 'tavg', 'temp_c', 'temp_f', 'temperature_2m', 'outside temp', 'outdoor temperature', 'dry bulb', 'tair', 'ta'],
  temperature_max: ['max temp', 'maximum temperature', 'tmax', 'temp max', 'high', 'max temperature', 'temperature_2m_max', 'maxtemp', 'max_temp', 'hi temp', 'high temp'],
  temperature_min: ['min temp', 'minimum temperature', 'tmin', 'temp min', 'low', 'min temperature', 'temperature_2m_min', 'mintemp', 'min_temp', 'low temp'],
  temperature_mean: ['mean temp', 'average temperature', 'avg temp', 'mean temperature', 'temperature_2m_mean', 'tmean', 'daily mean'],
  apparent_temperature: ['feels like', 'apparent temperature', 'feelslike', 'real feel', 'apparent temp'],
  dew_point: ['dew point', 'dewpoint', 'dew pt', 'td', 'dew_point_2m', 'dew'],
  heat_index: ['heat index', 'heatindex'],
  wind_chill: ['wind chill', 'windchill'],
  relative_humidity: ['humidity', 'relative humidity', 'rh', 'hum', 'rel hum', 'relative_humidity_2m', 'outside humidity', 'out hum'],
  precipitation: ['precipitation', 'precip', 'rain', 'rainfall', 'prcp', 'precipitation_sum', 'total precipitation', 'rain total', 'rain amount', 'ppt', 'rr'],
  rain: ['rain only', 'liquid rain', 'rain_sum'],
  precipitation_probability: ['chance of rain', 'precipitation probability', 'pop', 'precip probability', 'probability of precipitation'],
  snowfall: ['snowfall', 'snow', 'new snow', 'snow_sum', 'snwf'],
  snow_depth: ['snow depth', 'snow_depth', 'snwd', 'snow on ground'],
  wind_speed: ['wind speed', 'wind', 'windspeed', 'wspd', 'ws', 'avg wind', 'wind_speed_10m', 'mean wind', 'wind avg', 'sustained wind'],
  wind_speed_max: ['max wind', 'max wind speed', 'wind_speed_10m_max', 'wind max'],
  wind_gusts: ['gust', 'wind gust', 'gusts', 'wgust', 'wind_gusts_10m', 'peak gust', 'hi speed', 'high wind speed'],
  wind_gusts_max: ['max gust', 'wind_gusts_10m_max', 'maximum gust'],
  wind_direction: ['wind direction', 'wind dir', 'wdir', 'direction', 'wd', 'wind_direction_10m', 'winddir'],
  pressure_msl: ['pressure', 'sea level pressure', 'slp', 'mslp', 'pressure_msl', 'barometer', 'bar', 'baro', 'pres', 'atmospheric pressure'],
  surface_pressure: ['station pressure', 'surface pressure', 'surface_pressure'],
  cloud_cover: ['cloud cover', 'cloud', 'clouds', 'cloudiness', 'cloud_cover', 'sky cover'],
  visibility: ['visibility', 'vis', 'visib'],
  uv_index: ['uv', 'uv index', 'uvi', 'uv_index'],
  uv_index_max: ['uv max', 'uv_index_max', 'max uv'],
  shortwave_radiation: ['solar radiation', 'radiation', 'solar rad', 'shortwave', 'ghi', 'global radiation', 'solar', 'irradiance'],
  sunshine_duration: ['sunshine', 'sunshine hours', 'sunshine duration', 'sun hours'],
  soil_temperature_0cm: ['soil temperature', 'soil temp', 'ground temperature'],
  soil_moisture_0_1cm: ['soil moisture', 'soil water'],
  et0: ['et0', 'evapotranspiration', 'eto', 'reference et', 'et'],
  leaf_wetness: ['leaf wetness', 'leaf wet', 'leafwetness'],
  pm2_5: ['pm2.5', 'pm2_5', 'pm25'],
  pm10: ['pm10'],
  nitrogen_dioxide: ['no2', 'nitrogen dioxide'],
  ozone: ['o3', 'ozone'],
  wave_height: ['wave height', 'significant wave height', 'hs', 'swh'],
  sea_surface_temperature: ['sea temperature', 'sst', 'water temperature', 'sea surface temperature'],
};

const TIME_WORDS = ['datetime', 'date time', 'date/time', 'timestamp', 'time', 'date', 'day', 'valid', 'obs time', 'observation time', 'period'];

const normalise = (h: string) =>
  h
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/°[cfk]?|%|km\/h|m\/s|mph|knots?|hpa|mbar|inhg|mmhg|kpa|\bmm\b|\bin\b|\bcm\b/g, ' ')
    .replace(/[_\-./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function guessVariable(header: string, resolution: 'hourly' | 'daily' = 'hourly'): string {
  const h = normalise(header);
  if (!h) return '';
  let best = '';
  let bestScore = 0;
  for (const [id, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      let score = 0;
      if (h === a) score = 100 + a.length;
      else if (new RegExp(`(^|\\s)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(h)) score = 50 + a.length;
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
  }
  // "Temperature max" style headers win over plain temperature
  if (best === 'temperature' && /\bmax|high\b/.test(h)) best = 'temperature_max';
  if (best === 'temperature' && /\bmin|low\b/.test(h)) best = 'temperature_min';
  if (best === 'temperature' && /\bmean|avg|average\b/.test(h) && resolution === 'daily') best = 'temperature_mean';
  if (best === 'wind_speed' && /\bmax\b/.test(h)) best = 'wind_speed_max';
  if (best === 'wind_gusts' && /\bmax\b/.test(h) && resolution === 'daily') best = 'wind_gusts_max';
  return best;
}

/* ------------------------------- timestamps ------------------------------- */

const pad = (n: number) => String(n).padStart(2, '0');

/** Excel serial date (1900 system) → wall-clock "YYYY-MM-DDTHH:MM:SS". */
export function excelSerialToWall(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return d.toISOString().slice(0, 19);
}

/** Parse a date / datetime cell into a wall-clock string, or null. */
export function parseWallClock(cell: Cell, order: DateOrder, allowSerial: boolean): string | null {
  if (cell === null || cell === undefined || cell === '') return null;
  if (typeof cell === 'object' && 'date' in cell) return cell.date.slice(0, 19);
  if (typeof cell === 'number') {
    if (allowSerial && cell > 1 && cell < 2958466) return excelSerialToWall(cell);
    // Compact numeric forms: 20240131 or 2024013113
    const s = String(Math.trunc(cell));
    if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`;
    if (/^\d{10}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:00:00`;
    return null;
  }
  if (typeof cell !== 'string') return null;
  const s = cell.trim();
  // ISO / YMD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    let h = Number(m[4] ?? 0);
    if (m[7]) h = (h % 12) + (m[7].toLowerCase() === 'pm' ? 12 : 0);
    const wall = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}T${pad(h)}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
    if (m[8]) {
      // Explicit offset: convert to UTC wall clock and mark it
      const iso = `${wall}${m[8] === 'Z' ? 'Z' : m[8].length === 5 ? `${m[8].slice(0, 3)}:${m[8].slice(3)}` : m[8]}`;
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) return `${d.toISOString().slice(0, 19)}Z`;
    }
    return validWall(wall);
  }
  // D/M/Y or M/D/Y
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (m) {
    let [a, b] = [Number(m[1]), Number(m[2])];
    if (order === 'MDY') [a, b] = [b, a];
    let y = Number(m[3]);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    let h = Number(m[4] ?? 0);
    if (m[7]) h = (h % 12) + (m[7].toLowerCase() === 'pm' ? 12 : 0);
    return validWall(`${y}-${pad(b)}-${pad(a)}T${pad(h)}:${m[5] ?? '00'}:${m[6] ?? '00'}`);
  }
  // "31 Jan 2024", "Jan 31, 2024 13:00" and other forms the JS parser handles
  if (/[a-z]{3}/i.test(s)) {
    const d = new Date(`${s} UTC`);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 19);
  }
  return null;
}

function validWall(w: string): string | null {
  const d = new Date(`${w}Z`);
  if (Number.isNaN(d.getTime())) return null;
  // reject rollovers like 2024-02-31
  if (d.toISOString().slice(0, 10) !== w.slice(0, 10)) return null;
  return w;
}

/** Combine a date cell with a separate time-of-day cell ("13:00", 0.5416 fraction, or a date-typed time). */
function combineTime(dateWall: string, timeCell: Cell): string | null {
  if (timeCell === null || timeCell === '') return dateWall;
  let h = 0;
  let mi = 0;
  if (typeof timeCell === 'number') {
    if (timeCell >= 0 && timeCell < 1) {
      const mins = Math.round(timeCell * 1440);
      h = Math.floor(mins / 60);
      mi = mins % 60;
    } else if (Number.isInteger(timeCell) && timeCell >= 0 && timeCell <= 2400) {
      // 1300 or 13
      h = timeCell >= 100 ? Math.floor(timeCell / 100) : timeCell;
      mi = timeCell >= 100 ? timeCell % 100 : 0;
    } else return null;
  } else if (typeof timeCell === 'object' && 'date' in timeCell) {
    h = Number(timeCell.date.slice(11, 13));
    mi = Number(timeCell.date.slice(14, 16));
  } else if (typeof timeCell === 'string') {
    const m = timeCell.trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/i);
    if (!m) return null;
    h = Number(m[1]);
    mi = Number(m[2] ?? 0);
    if (m[3]) h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  } else return null;
  if (h === 24 && mi === 0) {
    const d = new Date(`${dateWall.slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return `${d.toISOString().slice(0, 10)}T00:00:00`;
  }
  if (h > 23 || mi > 59) return null;
  return `${dateWall.slice(0, 10)}T${pad(h)}:${pad(mi)}:00`;
}

/* ------------------------------- detection ------------------------------- */

const isBlank = (c: Cell) => c === null || c === undefined || (typeof c === 'string' && c.trim() === '');
const asText = (c: Cell): string => (c === null || c === undefined ? '' : typeof c === 'object' ? c.date : String(c));

export function detectHeaderRow(rows: Cell[][]): number {
  const limit = Math.min(rows.length, 30);
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < limit; r++) {
    const row = rows[r] ?? [];
    const texts = row.filter((c) => typeof c === 'string' && c.trim() && Number.isNaN(Number(c))).length;
    if (texts < 2) continue;
    // the following rows should contain numbers or dates
    const next = rows.slice(r + 1, r + 6);
    const dataLike = next.filter((nr) => nr.some((c) => typeof c === 'number' || (typeof c === 'object' && c !== null))).length;
    const score = texts + dataLike * 2;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

export function detectDateOrder(cells: Cell[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const c of cells.slice(0, 500)) {
    if (typeof c !== 'string') continue;
    const m = c.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  if (mdy > dmy) return 'MDY';
  return 'DMY';
}

function columnIsDates(rows: Cell[][], col: number, order: DateOrder, header: string): number {
  const sample = rows.slice(0, 50).map((r) => r[col]).filter((c) => !isBlank(c));
  if (!sample.length) return 0;
  const headerSaysDate = TIME_WORDS.some((w) => normalise(header).includes(w));
  const ok = sample.filter((c) => {
    if (typeof c === 'number') return headerSaysDate && c > 10000 && c < 80000;
    return parseWallClock(c, order, false) !== null;
  }).length;
  return ok / sample.length + (headerSaysDate ? 0.5 : 0);
}

function columnIsTimeOfDay(rows: Cell[][], col: number, header: string): boolean {
  const h = normalise(header);
  if (!/\b(time|hour|hr)\b/.test(h) || /date/.test(h)) return false;
  const sample = rows.slice(0, 30).map((r) => r[col]).filter((c) => !isBlank(c));
  return sample.length > 0 && sample.every((c) => combineTime('2000-01-01T00:00:00', c) !== null);
}

export function autoConfig(sheet: SheetData, defaultTz: string, forcedHeaderRow?: number): ImportConfig {
  const headerRow = forcedHeaderRow ?? detectHeaderRow(sheet.rows);
  const headers = (sheet.rows[headerRow] ?? []).map(asText);
  const body = sheet.rows.slice(headerRow + 1);
  const width = Math.max(headers.length, ...body.slice(0, 50).map((r) => r.length));
  const order = detectDateOrder(body.map((r) => r.find((c) => typeof c === 'string' && /\d[-/.]\d/.test(c)) ?? null));
  let timeColumn = 0;
  let best = 0;
  for (let c = 0; c < width; c++) {
    const s = columnIsDates(body, c, order, headers[c] ?? '');
    if (s > best) {
      best = s;
      timeColumn = c;
    }
  }
  let timeOfDayColumn: number | null = null;
  for (let c = 0; c < width; c++) {
    if (c !== timeColumn && columnIsTimeOfDay(body, c, headers[c] ?? '')) {
      timeOfDayColumn = c;
      break;
    }
  }
  const draft: ImportConfig = {
    headerRow,
    timeColumn,
    timeOfDayColumn,
    dateOrder: order,
    timezone: defaultTz,
    resolution: 'auto',
    mappings: [],
    missingMarkers: ['NA', 'N/A', 'n/a', '-', '--', '—', 'null', 'NaN', '-9999', '-999', '9999', 'M', '#N/A'],
    excludeImplausible: true,
  };
  const res = detectResolution(body, draft);
  const used = new Set<string>();
  for (let c = 0; c < width; c++) {
    if (c === timeColumn || c === timeOfDayColumn) continue;
    const header = headers[c] || `Column ${c + 1}`;
    let variable = guessVariable(header, res === 'daily' ? 'daily' : 'hourly');
    // daily datasets: map plain temperature/wind to daily equivalents only when appropriate
    if (variable && used.has(variable)) variable = '';
    if (variable) used.add(variable);
    const def = getVariable(variable);
    draft.mappings.push({ column: c, header, variable, unit: def ? (guessSourceUnit(header, def.quantity) ?? '') : '' });
  }
  return { ...draft, resolution: 'auto' };
}

function rowWall(row: Cell[], cfg: ImportConfig): string | null {
  const allowSerial = true;
  const base = parseWallClock(row[cfg.timeColumn] ?? null, cfg.dateOrder, allowSerial);
  if (!base) return null;
  if (cfg.timeOfDayColumn !== null) return combineTime(base, row[cfg.timeOfDayColumn] ?? null);
  return base;
}

export function detectResolution(body: Cell[][], cfg: ImportConfig): 'hourly' | 'daily' | 'subhourly' {
  const ts: number[] = [];
  for (const r of body.slice(0, 400)) {
    const w = rowWall(r, cfg);
    if (w) ts.push(Date.parse(w.endsWith('Z') ? w : `${w}Z`));
  }
  const diffs: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const d = Math.abs(ts[i] - ts[i - 1]);
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) {
    // single row, or all midnight: look at the times
    return ts.every((t) => t % 86400000 === 0) ? 'daily' : 'hourly';
  }
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  if (median < 55 * 60_000) return 'subhourly';
  if (median < 20 * 3600_000) return 'hourly';
  return 'daily';
}

/* ------------------------------- validation & conversion ------------------------------- */

/** Physically plausible ranges in canonical units. Values outside are flagged. */
const PLAUSIBLE: Record<string, [number, number]> = {
  temperature: [-95, 65],
  temperature_max: [-95, 65],
  temperature_min: [-95, 65],
  temperature_mean: [-95, 65],
  apparent_temperature: [-110, 80],
  dew_point: [-100, 40],
  relative_humidity: [0, 100.5],
  precipitation: [0, 2000],
  rain: [0, 2000],
  snowfall: [0, 500],
  snow_depth: [0, 3000],
  wind_speed: [0, 420],
  wind_speed_max: [0, 420],
  wind_gusts: [0, 450],
  wind_gusts_max: [0, 450],
  wind_direction: [0, 360],
  pressure_msl: [850, 1090],
  surface_pressure: [300, 1090],
  cloud_cover: [0, 100],
  visibility: [0, 500],
  uv_index: [0, 25],
  shortwave_radiation: [0, 1500],
  precipitation_probability: [0, 100],
  leaf_wetness: [0, 100],
};

export interface ImportIssue {
  level: 'error' | 'warning' | 'info';
  message: string;
  rows?: number[]; // 1-based spreadsheet row numbers (first few)
}

export interface ImportResult {
  resolution: 'hourly' | 'daily';
  /** Hourly: UTC ISO. Daily: YYYY-MM-DD. */
  time: string[];
  series: Record<string, (number | null)[]>;
  issues: ImportIssue[];
  stats: {
    rowsRead: number;
    rowsImported: number;
    invalidTimestamps: number;
    duplicates: number;
    missingValues: Record<string, number>;
    invalidValues: Record<string, number>;
    implausibleValues: Record<string, number>;
    aggregatedFromSubhourly: boolean;
  };
}

export function runImport(sheet: SheetData, cfg: ImportConfig): ImportResult {
  const body = sheet.rows.slice(cfg.headerRow + 1);
  const firstRowNumber = cfg.headerRow + 2; // spreadsheet row of body[0]
  const issues: ImportIssue[] = [];
  const mappings = cfg.mappings.filter((m) => m.variable);
  const markers = new Set(cfg.missingMarkers.map((m) => m.trim().toLowerCase()));
  const detected = detectResolution(body, cfg);
  const subhourly = detected === 'subhourly';
  const resolution: 'hourly' | 'daily' = cfg.resolution === 'auto' ? (detected === 'daily' ? 'daily' : 'hourly') : cfg.resolution;

  const varIds = mappings.map((m) => m.variable);
  const dupVars = varIds.filter((v, i) => varIds.indexOf(v) !== i);
  if (dupVars.length) issues.push({ level: 'error', message: `More than one column is mapped to ${[...new Set(dupVars)].map((v) => getVariable(v)?.label ?? v).join(', ')}. Map each variable once.` });
  if (!mappings.length) issues.push({ level: 'error', message: 'No columns are mapped to weather variables yet.' });
  for (const m of mappings) {
    const def = getVariable(m.variable);
    if (!def) continue;
    if (!def.resolutions.includes(resolution)) {
      issues.push({ level: 'warning', message: `"${m.header}" is mapped to ${def.label}, which is usually a ${def.resolutions.join('/')} variable, but this dataset is ${resolution}.` });
    }
  }

  const missing: Record<string, number> = {};
  const invalid: Record<string, number> = {};
  const implausible: Record<string, number> = {};
  const invalidTsRows: number[] = [];
  const dupRows: number[] = [];
  const invalidValueRows: Record<string, number[]> = {};
  const implausibleRows: Record<string, number[]> = {};
  for (const v of varIds) {
    missing[v] = 0;
    invalid[v] = 0;
    implausible[v] = 0;
  }

  // key → values (sub-hourly rows collect into lists for aggregation)
  const buckets = new Map<string, Record<string, (number | null)[]>>();
  const seenExact = new Set<string>();
  let rowsRead = 0;

  body.forEach((row, i) => {
    if (!row || row.every(isBlank)) return;
    rowsRead++;
    const rowNo = firstRowNumber + i;
    const wall = rowWall(row, cfg);
    if (!wall) {
      invalidTsRows.push(rowNo);
      return;
    }
    let key: string;
    let exact: string;
    if (resolution === 'daily') {
      key = wall.slice(0, 10);
      exact = key;
    } else {
      const utc = wall.endsWith('Z') ? new Date(wall) : zonedToUtc(wall, cfg.timezone);
      if (Number.isNaN(utc.getTime())) {
        invalidTsRows.push(rowNo);
        return;
      }
      exact = toIsoUtc(utc);
      const hour = new Date(utc);
      // sub-hourly data is grouped into the hour it ends in (e.g. 10:10–11:00 → 11:00), matching the "preceding hour" convention
      if (subhourly && (hour.getUTCMinutes() !== 0 || hour.getUTCSeconds() !== 0)) hour.setUTCHours(hour.getUTCHours() + 1, 0, 0, 0);
      else hour.setUTCMinutes(0, 0, 0);
      key = toIsoUtc(hour);
    }
    if (seenExact.has(exact)) {
      dupRows.push(rowNo);
      return;
    }
    seenExact.add(exact);
    const bucket = buckets.get(key) ?? Object.fromEntries(varIds.map((v) => [v, [] as (number | null)[]]));
    for (const m of mappings) {
      const raw = row[m.column] ?? null;
      let val: number | null = null;
      if (isBlank(raw) || (typeof raw === 'string' && markers.has(raw.trim().toLowerCase())) || (typeof raw === 'number' && markers.has(String(raw)))) {
        missing[m.variable]++;
      } else {
        const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim().replace(/,/g, '.').replace(/\s/g, '').replace(/[^0-9eE.+-]/g, '')) : NaN;
        if (typeof raw === 'string' && /[a-z]{2,}/i.test(raw.replace(/[°%]|km\/h|mph|mm|hpa|in|cm/gi, ''))) {
          invalid[m.variable]++;
          (invalidValueRows[m.variable] ??= []).push(rowNo);
        } else if (!Number.isFinite(num)) {
          invalid[m.variable]++;
          (invalidValueRows[m.variable] ??= []).push(rowNo);
        } else {
          const unit = getSourceUnit(m.unit);
          val = unit ? unit.toCanonical(num) : num;
          const range = PLAUSIBLE[m.variable];
          if (range && (val < range[0] || val > range[1])) {
            implausible[m.variable]++;
            (implausibleRows[m.variable] ??= []).push(rowNo);
            if (cfg.excludeImplausible) val = null;
          }
        }
      }
      bucket[m.variable].push(val);
    }
    buckets.set(key, bucket);
  });

  const keys = [...buckets.keys()].sort();
  const series: Record<string, (number | null)[]> = {};
  for (const v of varIds) {
    const agg = getVariable(v)?.aggregation ?? 'mean';
    series[v] = keys.map((k) => {
      const vals = buckets.get(k)![v];
      if (vals.length <= 1) return vals[0] ?? null;
      return aggregate(vals, agg === 'min' || agg === 'max' || agg === 'sum' || agg === 'direction' ? agg : 'mean');
    });
  }

  const first = (xs: number[]) => xs.slice(0, 8);
  if (invalidTsRows.length) issues.push({ level: 'warning', message: `${invalidTsRows.length} row(s) have a missing or unreadable timestamp and will be skipped.`, rows: first(invalidTsRows) });
  if (dupRows.length) issues.push({ level: 'warning', message: `${dupRows.length} duplicate timestamp(s) found. The first occurrence is kept.`, rows: first(dupRows) });
  for (const v of varIds) {
    const label = getVariable(v)?.label ?? v;
    if (invalid[v]) issues.push({ level: 'warning', message: `${label}: ${invalid[v]} value(s) are not numbers and will be treated as missing.`, rows: first(invalidValueRows[v] ?? []) });
    if (implausible[v])
      issues.push({
        level: 'warning',
        message: `${label}: ${implausible[v]} value(s) are outside the physically plausible range${cfg.excludeImplausible ? ' and will be excluded' : ''}. Check the unit selection.`,
        rows: first(implausibleRows[v] ?? []),
      });
    if (missing[v]) issues.push({ level: 'info', message: `${label}: ${missing[v]} empty or missing value(s).` });
  }
  if (subhourly && resolution === 'hourly') issues.push({ level: 'info', message: 'Timestamps are less than an hour apart. Values will be combined into hourly values (averages, or totals for precipitation).' });
  if (keys.length > 1 && resolution === 'hourly') {
    const span = (Date.parse(keys[keys.length - 1]) - Date.parse(keys[0])) / 3600_000 + 1;
    const gaps = span - keys.length;
    if (gaps > 0) issues.push({ level: 'info', message: `${gaps} hour(s) within the date range have no rows at all.` });
  }
  if (!keys.length) issues.push({ level: 'error', message: 'No rows with valid timestamps were found. Check the timestamp column and date order.' });

  return {
    resolution,
    time: keys,
    series,
    issues,
    stats: {
      rowsRead,
      rowsImported: keys.length,
      invalidTimestamps: invalidTsRows.length,
      duplicates: dupRows.length,
      missingValues: missing,
      invalidValues: invalid,
      implausibleValues: implausible,
      aggregatedFromSubhourly: subhourly && resolution === 'hourly',
    },
  };
}

export const IMPORTABLE_VARIABLES = VARIABLES;
