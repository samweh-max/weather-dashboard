import 'server-only';
import { randomUUID } from 'node:crypto';
import { addCalculatedDaily, addCalculatedHourly, deriveDaily } from '../calc';
import type { ImportedDatasetMeta, Series, WeatherDataset } from '../types';
import { getDb } from './db';

export interface StoredData {
  time: string[];
  series: Record<string, (number | null)[]>;
}

export function listDatasets(): ImportedDatasetMeta[] {
  return getDb()
    .prepare('SELECT meta FROM datasets ORDER BY created_at DESC')
    .all()
    .map((r) => JSON.parse(String(r.meta)));
}

export function getDatasetRaw(id: string): { meta: ImportedDatasetMeta; data: StoredData } | null {
  const row = getDb().prepare('SELECT meta, data FROM datasets WHERE id = ?').get(id);
  if (!row) return null;
  return { meta: JSON.parse(String(row.meta)), data: JSON.parse(String(row.data)) };
}

export function saveDataset(meta: Omit<ImportedDatasetMeta, 'id' | 'createdAt'>, data: StoredData): ImportedDatasetMeta {
  const full: ImportedDatasetMeta = { ...meta, id: randomUUID(), createdAt: new Date().toISOString() };
  getDb().prepare('INSERT INTO datasets (id, meta, data, created_at) VALUES (?, ?, ?, ?)').run(full.id, JSON.stringify(full), JSON.stringify(data), full.createdAt);
  return full;
}

export function deleteDataset(id: string): boolean {
  const r = getDb().prepare('DELETE FROM datasets WHERE id = ?').run(id) as { changes?: number };
  return (r?.changes ?? 0) > 0;
}

/** Present an imported dataset in the same shape as provider data, optionally restricted to a date range. */
export function datasetAsWeather(id: string, start?: string, end?: string): WeatherDataset | null {
  const raw = getDatasetRaw(id);
  if (!raw) return null;
  const { meta, data } = raw;
  const tz = meta.timezone || 'UTC';
  let idx = data.time.map((_, i) => i);
  if (start || end) {
    idx = idx.filter((i) => {
      const t = data.time[i];
      const d = meta.resolution === 'daily' ? t : new Date(t).toISOString().slice(0, 10);
      return (!start || d >= start) && (!end || d <= end);
    });
  }
  const time = idx.map((i) => data.time[i]);
  const series: Record<string, Series> = {};
  for (const [k, vals] of Object.entries(data.series)) series[k] = { values: idx.map((i) => vals[i]), origin: 'provider', note: 'User-imported value.' };
  const location = meta.location ?? { name: meta.name, latitude: NaN, longitude: NaN, timezone: tz };
  const base: WeatherDataset = {
    providerId: `import:${meta.id}`,
    providerName: `Imported: ${meta.name}`,
    kind: 'imported',
    location,
    timezone: tz,
    fetchedAt: meta.createdAt,
    updatedAt: meta.createdAt,
    notes: [`Imported from ${meta.sourceFile} (sheet "${meta.sheet}") on ${meta.createdAt.slice(0, 10)}.`, ...meta.warnings],
    attribution: { text: 'User-imported dataset', url: '' },
  };
  if (meta.resolution === 'daily') {
    return { ...base, daily: addCalculatedDaily({ time, series }) };
  }
  const hourly = addCalculatedHourly({ time, series });
  return { ...base, hourly, daily: addCalculatedDaily(deriveDaily(hourly, tz, undefined, 18)) };
}
