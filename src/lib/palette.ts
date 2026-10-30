/**
 * Chart colours. Each source has a FIXED slot in the validated categorical palette
 * (see globals.css), so its colour never changes when others are added or removed.
 * Sources beyond the 8 slots reuse a hue with a dashed line as secondary encoding.
 */
export interface SeriesStyle {
  color: string;
  dash?: string;
}

const SLOTS: Record<string, SeriesStyle> = {
  'om-best': { color: 'var(--series-1)' },
  'om-gfs': { color: 'var(--series-2)' },
  'om-icon': { color: 'var(--series-3)' },
  'nws': { color: 'var(--series-4)' },
  'om-meteofrance': { color: 'var(--series-5)' },
  metno: { color: 'var(--series-6)' },
  'om-ecmwf': { color: 'var(--series-7)' },
  'om-ukmo': { color: 'var(--series-8)' },
  'om-gem': { color: 'var(--series-1)', dash: '6 4' },
  'om-jma': { color: 'var(--series-2)', dash: '6 4' },
  metoffice: { color: 'var(--series-8)', dash: '6 4' },
  'om-era5': { color: 'var(--series-3)' },
  'nws-obs': { color: 'var(--series-4)', dash: '2 3' },
};

export function seriesStyle(id: string, fallbackIndex = 0): SeriesStyle {
  if (SLOTS[id]) return SLOTS[id];
  // imported datasets and anything new: cycle with a distinct dash so identity never relies on colour alone
  const n = (fallbackIndex % 8) + 1;
  return { color: `var(--series-${n})`, dash: '1 3' };
}
