import type { Condition } from './types';

/** WMO weather interpretation codes (used by Open-Meteo). */
export const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Violent showers',
  85: 'Light snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
};

export function wmoToCondition(code: number | null | undefined): Condition | null {
  if (code === null || code === undefined) return null;
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 55) return 'drizzle';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'sleet';
  if (code === 65 || code === 82) return 'heavy-rain';
  if ((code >= 61 && code <= 63) || code === 80 || code === 81) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunderstorm';
  return null;
}

/** MET Norway symbol codes, e.g. "lightrainshowers_day". */
export function metnoSymbolToCondition(symbol: string | null | undefined): Condition | null {
  if (!symbol) return null;
  const s = symbol.replace(/_(day|night|polartwilight)$/, '');
  if (s.includes('thunder')) return 'thunderstorm';
  if (s.includes('sleet')) return 'sleet';
  if (s.includes('snow')) return 'snow';
  if (s.startsWith('heavyrain')) return 'heavy-rain';
  if (s.startsWith('lightrain')) return 'drizzle';
  if (s.includes('rain')) return 'rain';
  if (s === 'fog') return 'fog';
  if (s === 'cloudy') return 'cloudy';
  if (s === 'partlycloudy') return 'partly-cloudy';
  if (s === 'fair' || s === 'clearsky') return s === 'fair' ? 'partly-cloudy' : 'clear';
  return null;
}

export function metnoSymbolText(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  const s = symbol.replace(/_(day|night|polartwilight)$/, '');
  const words = s
    .replace('clearsky', 'clear sky')
    .replace('partlycloudy', 'partly cloudy')
    .replace(/^(light|heavy)/, '$1 ')
    .replace('rainshowers', 'rain showers')
    .replace('snowshowers', 'snow showers')
    .replace('sleetshowers', 'sleet showers')
    .replace('andthunder', ' and thunder');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Met Office DataHub significant weather codes. */
export const MET_OFFICE_CODES: Record<number, [string, Condition]> = {
  0: ['Clear night', 'clear'],
  1: ['Sunny day', 'clear'],
  2: ['Partly cloudy', 'partly-cloudy'],
  3: ['Partly cloudy', 'partly-cloudy'],
  5: ['Mist', 'fog'],
  6: ['Fog', 'fog'],
  7: ['Cloudy', 'cloudy'],
  8: ['Overcast', 'cloudy'],
  9: ['Light rain shower', 'drizzle'],
  10: ['Light rain shower', 'drizzle'],
  11: ['Drizzle', 'drizzle'],
  12: ['Light rain', 'drizzle'],
  13: ['Heavy rain shower', 'heavy-rain'],
  14: ['Heavy rain shower', 'heavy-rain'],
  15: ['Heavy rain', 'heavy-rain'],
  16: ['Sleet shower', 'sleet'],
  17: ['Sleet shower', 'sleet'],
  18: ['Sleet', 'sleet'],
  19: ['Hail shower', 'sleet'],
  20: ['Hail shower', 'sleet'],
  21: ['Hail', 'sleet'],
  22: ['Light snow shower', 'snow'],
  23: ['Light snow shower', 'snow'],
  24: ['Light snow', 'snow'],
  25: ['Heavy snow shower', 'snow'],
  26: ['Heavy snow shower', 'snow'],
  27: ['Heavy snow', 'snow'],
  28: ['Thunder shower', 'thunderstorm'],
  29: ['Thunder shower', 'thunderstorm'],
  30: ['Thunder', 'thunderstorm'],
};

/** NWS free-text forecasts, e.g. "Chance Showers And Thunderstorms". */
export function textToCondition(text: string | null | undefined): Condition | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (t.includes('thunder') || t.includes('t-storm')) return 'thunderstorm';
  if (t.includes('sleet') || t.includes('freezing') || t.includes('ice') || t.includes('hail')) return 'sleet';
  if (t.includes('snow') || t.includes('flurr') || t.includes('blizzard')) return 'snow';
  if (t.includes('heavy rain')) return 'heavy-rain';
  if (t.includes('drizzle') || t.includes('sprinkle')) return 'drizzle';
  if (t.includes('rain') || t.includes('shower')) return 'rain';
  if (t.includes('fog') || t.includes('mist') || t.includes('haze') || t.includes('smoke')) return 'fog';
  if (t.includes('overcast') || t.includes('mostly cloudy') || t === 'cloudy') return 'cloudy';
  if (t.includes('partly') || t.includes('mostly sunny') || t.includes('mostly clear') || t.includes('few clouds')) return 'partly-cloudy';
  if (t.includes('sunny') || t.includes('clear') || t.includes('fair')) return 'clear';
  if (t.includes('cloud')) return 'cloudy';
  return null;
}

export const CONDITION_LABELS: Record<Condition, string> = {
  clear: 'Clear',
  'partly-cloudy': 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  drizzle: 'Drizzle',
  rain: 'Rain',
  'heavy-rain': 'Heavy rain',
  snow: 'Snow',
  sleet: 'Sleet',
  thunderstorm: 'Thunderstorm',
};
