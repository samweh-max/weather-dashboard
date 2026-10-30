import type { Quantity } from './variables';
import { getVariable } from './variables';

export type TempUnit = 'C' | 'F';
export type SpeedUnit = 'kmh' | 'ms' | 'mph' | 'kn';
export type PrecipUnit = 'mm' | 'in';
export type PressureUnit = 'hPa' | 'inHg' | 'mmHg' | 'kPa';
export type DistanceUnit = 'km' | 'mi';

export interface UnitPrefs {
  temperature: TempUnit;
  speed: SpeedUnit;
  precipitation: PrecipUnit;
  pressure: PressureUnit;
  distance: DistanceUnit;
}

export const DEFAULT_UNITS: UnitPrefs = {
  temperature: 'C',
  speed: 'kmh',
  precipitation: 'mm',
  pressure: 'hPa',
  distance: 'km',
};

export const UNIT_LABELS = {
  temperature: { C: '°C', F: '°F' },
  speed: { kmh: 'km/h', ms: 'm/s', mph: 'mph', kn: 'kn' },
  precipitation: { mm: 'mm', in: 'in' },
  pressure: { hPa: 'hPa', inHg: 'inHg', mmHg: 'mmHg', kPa: 'kPa' },
  distance: { km: 'km', mi: 'mi' },
} as const;

/* ---------- raw conversions into canonical units (used by providers & import) ---------- */

export const fToC = (f: number) => ((f - 32) * 5) / 9;
export const cToF = (c: number) => (c * 9) / 5 + 32;
export const kToC = (k: number) => k - 273.15;
export const msToKmh = (ms: number) => ms * 3.6;
export const mphToKmh = (mph: number) => mph * 1.609344;
export const knToKmh = (kn: number) => kn * 1.852;
export const paToHpa = (pa: number) => pa / 100;
export const inHgToHpa = (inHg: number) => inHg * 33.8638866667;
export const mmHgToHpa = (mmHg: number) => mmHg * 1.33322387415;
export const inToMm = (inch: number) => inch * 25.4;

/** Canonical → display conversion for a given quantity and the user's preferences. */
export function convertForDisplay(value: number, quantity: Quantity, prefs: UnitPrefs): number {
  switch (quantity) {
    case 'temperature':
      return prefs.temperature === 'F' ? cToF(value) : value;
    case 'degreeDays':
      return prefs.temperature === 'F' ? (value * 9) / 5 : value;
    case 'speed':
      switch (prefs.speed) {
        case 'ms':
          return value / 3.6;
        case 'mph':
          return value / 1.609344;
        case 'kn':
          return value / 1.852;
        default:
          return value;
      }
    case 'precipitation':
      return prefs.precipitation === 'in' ? value / 25.4 : value;
    case 'snow':
      return prefs.precipitation === 'in' ? value / 2.54 : value;
    case 'pressure':
      switch (prefs.pressure) {
        case 'inHg':
          return value / 33.8638866667;
        case 'mmHg':
          return value / 1.33322387415;
        case 'kPa':
          return value / 10;
        default:
          return value;
      }
    case 'distance':
      return prefs.distance === 'mi' ? value / 1.609344 : value;
    default:
      return value;
  }
}

export function displayUnit(quantity: Quantity, canonicalUnit: string, prefs: UnitPrefs): string {
  switch (quantity) {
    case 'temperature':
      return UNIT_LABELS.temperature[prefs.temperature];
    case 'degreeDays':
      return prefs.temperature === 'F' ? '°F·d' : '°C·d';
    case 'speed':
      return UNIT_LABELS.speed[prefs.speed];
    case 'precipitation':
      return UNIT_LABELS.precipitation[prefs.precipitation];
    case 'snow':
      return prefs.precipitation === 'in' ? 'in' : 'cm';
    case 'pressure':
      return UNIT_LABELS.pressure[prefs.pressure];
    case 'distance':
      return UNIT_LABELS.distance[prefs.distance];
    default:
      return canonicalUnit;
  }
}

/** Convert a value of a registered variable to the user's display units. */
export function toDisplay(varId: string, value: number | null | undefined, prefs: UnitPrefs): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const def = getVariable(varId);
  if (!def) return value;
  return convertForDisplay(value, def.quantity, prefs);
}

export function unitFor(varId: string, prefs: UnitPrefs): string {
  const def = getVariable(varId);
  if (!def) return '';
  return displayUnit(def.quantity, def.unit, prefs);
}

/** Sensible decimals for display (exports keep full precision). */
export function decimalsFor(varId: string, prefs: UnitPrefs): number {
  const def = getVariable(varId);
  if (!def) return 1;
  switch (def.quantity) {
    case 'temperature':
    case 'speed':
    case 'percent':
    case 'direction':
    case 'concentration':
      return 0;
    case 'precipitation':
      return prefs.precipitation === 'in' ? 2 : 1;
    case 'pressure':
      return prefs.pressure === 'inHg' || prefs.pressure === 'kPa' ? 2 : 0;
    case 'soilMoisture':
      return 3;
    default:
      return 1;
  }
}

export function formatValue(varId: string, value: number | null | undefined, prefs: UnitPrefs, withUnit = true): string {
  const d = toDisplay(varId, value, prefs);
  if (d === null) return '—';
  const dec = decimalsFor(varId, prefs);
  const n = d.toLocaleString(undefined, { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  if (!withUnit) return n;
  const u = unitFor(varId, prefs);
  if (!u) return n;
  if (u.startsWith('°') && u.length <= 2) return `${n}${u}`;
  return `${n} ${u}`;
}

/* ---------- import unit handling: every source unit a column may be in ---------- */

export interface SourceUnit {
  id: string;
  label: string;
  quantity: Quantity;
  toCanonical: (x: number) => number;
}

const id = (x: number) => x;

export const SOURCE_UNITS: SourceUnit[] = [
  { id: 'C', label: '°C', quantity: 'temperature', toCanonical: id },
  { id: 'F', label: '°F', quantity: 'temperature', toCanonical: fToC },
  { id: 'K', label: 'K', quantity: 'temperature', toCanonical: kToC },
  { id: 'kmh', label: 'km/h', quantity: 'speed', toCanonical: id },
  { id: 'ms', label: 'm/s', quantity: 'speed', toCanonical: msToKmh },
  { id: 'mph', label: 'mph', quantity: 'speed', toCanonical: mphToKmh },
  { id: 'kn', label: 'knots', quantity: 'speed', toCanonical: knToKmh },
  { id: 'mm', label: 'mm', quantity: 'precipitation', toCanonical: id },
  { id: 'in', label: 'inches', quantity: 'precipitation', toCanonical: inToMm },
  { id: 'cm_p', label: 'cm', quantity: 'precipitation', toCanonical: (x) => x * 10 },
  { id: 'cm', label: 'cm', quantity: 'snow', toCanonical: id },
  { id: 'mm_s', label: 'mm', quantity: 'snow', toCanonical: (x) => x / 10 },
  { id: 'm_s', label: 'm', quantity: 'snow', toCanonical: (x) => x * 100 },
  { id: 'in_s', label: 'inches', quantity: 'snow', toCanonical: (x) => x * 2.54 },
  { id: 'hPa', label: 'hPa / mbar', quantity: 'pressure', toCanonical: id },
  { id: 'Pa', label: 'Pa', quantity: 'pressure', toCanonical: paToHpa },
  { id: 'kPa', label: 'kPa', quantity: 'pressure', toCanonical: (x) => x * 10 },
  { id: 'inHg', label: 'inHg', quantity: 'pressure', toCanonical: inHgToHpa },
  { id: 'mmHg', label: 'mmHg', quantity: 'pressure', toCanonical: mmHgToHpa },
  { id: 'km', label: 'km', quantity: 'distance', toCanonical: id },
  { id: 'm', label: 'm', quantity: 'distance', toCanonical: (x) => x / 1000 },
  { id: 'mi', label: 'miles', quantity: 'distance', toCanonical: (x) => x * 1.609344 },
  { id: 'pct', label: '%', quantity: 'percent', toCanonical: id },
  { id: 'frac', label: 'fraction 0–1', quantity: 'percent', toCanonical: (x) => x * 100 },
];

export function sourceUnitsFor(quantity: Quantity): SourceUnit[] {
  return SOURCE_UNITS.filter((u) => u.quantity === quantity);
}

export function getSourceUnit(unitId: string): SourceUnit | undefined {
  return SOURCE_UNITS.find((u) => u.id === unitId);
}

/** Guess a source unit from a header string such as "Temp (°F)" or "wind_mph". */
export function guessSourceUnit(header: string, quantity: Quantity): string | undefined {
  const h = header.toLowerCase();
  const options = sourceUnitsFor(quantity);
  if (!options.length) return undefined;
  const has = (...needles: string[]) => needles.some((n) => h.includes(n));
  switch (quantity) {
    case 'temperature':
      if (has('°f', '(f)', '[f]', 'degf', '_f', ' f)', 'fahrenheit')) return 'F';
      if (has('(k)', '[k]', 'kelvin')) return 'K';
      return 'C';
    case 'speed':
      if (has('mph', 'mi/h')) return 'mph';
      if (has('m/s', 'ms-1', 'm s-1', '_ms', '(ms)', 'mps')) return 'ms';
      if (has('knot', '(kn', 'kts', '(kt')) return 'kn';
      return 'kmh';
    case 'precipitation':
      if (has('(in', '[in', 'inch', '_in')) return 'in';
      if (has('(cm', '[cm')) return 'cm_p';
      return 'mm';
    case 'snow':
      if (has('(in', '[in', 'inch', '_in')) return 'in_s';
      if (has('(mm', '[mm', '_mm')) return 'mm_s';
      if (has('(m)', '[m]')) return 'm_s';
      return 'cm';
    case 'pressure':
      if (has('inhg')) return 'inHg';
      if (has('mmhg')) return 'mmHg';
      if (has('kpa')) return 'kPa';
      if (has('(pa)', '[pa]')) return 'Pa';
      return 'hPa';
    case 'distance':
      if (has('(mi', 'mile')) return 'mi';
      if (has('(m)', '[m]', '_m')) return 'm';
      return 'km';
    case 'percent':
      return 'pct';
    default:
      return options[0]?.id;
  }
}
