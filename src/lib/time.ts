/** Time helpers. Hourly data uses ISO UTC strings, daily data uses local "YYYY-MM-DD" dates. */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export function safeTimeZone(tz: string | undefined | null): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(date: Date | string | number, timeZone: string): LocalParts {
  const d = date instanceof Date ? date : new Date(date);
  const parts = partsFormatter(safeTimeZone(timeZone)).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Local calendar date of a UTC instant, e.g. "2026-10-30". */
export function localDate(date: Date | string | number, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Offset of the timezone from UTC at a given instant, in seconds. */
export function tzOffsetSeconds(date: Date | string | number, timeZone: string): number {
  const d = date instanceof Date ? date : new Date(date);
  const p = localParts(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 1000);
}

/** "2026-10-30T14:00" wall-clock time in tz → UTC Date. Handles DST by iterating once. */
export function zonedToUtc(local: string, timeZone: string): Date {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return new Date(NaN);
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  let off = tzOffsetSeconds(new Date(guess), timeZone);
  let utc = guess - off * 1000;
  const off2 = tzOffsetSeconds(new Date(utc), timeZone);
  if (off2 !== off) {
    off = off2;
    utc = guess - off * 1000;
  }
  return new Date(utc);
}

export function toIsoUtc(d: Date | number): string {
  const date = typeof d === 'number' ? new Date(d) : d;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Floor an instant to the whole UTC hour. */
export function floorHourIso(d: Date | string | number): string {
  const date = new Date(d);
  date.setUTCMinutes(0, 0, 0);
  return toIsoUtc(date);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

export function todayIn(timeZone: string): string {
  return localDate(new Date(), timeZone);
}

/** Pick the timezone to display times in, based on the user's setting. */
export function displayZone(setting: string, locationTz: string | undefined): string {
  if (setting === 'location') return safeTimeZone(locationTz);
  if (setting === 'browser') return Intl.DateTimeFormat().resolvedOptions().timeZone;
  return safeTimeZone(setting);
}

export function formatTime(iso: string | null | undefined, timeZone: string, opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: safeTimeZone(timeZone) }).format(d);
}

export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  // daily dates are calendar dates; format them in UTC so they never shift
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(d);
}

export function relativeAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'unknown';
  const diff = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(diff)) return 'unknown';
  if (diff < 0) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}
