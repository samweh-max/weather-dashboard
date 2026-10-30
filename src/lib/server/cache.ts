import 'server-only';
import { getDb } from './db';

/**
 * Two-level cache: in-memory for the running process, SQLite so it survives restarts.
 * Keeps us well inside free-tier rate limits (Open-Meteo: 10 000 calls/day non-commercial).
 */
const memory = new Map<string, { value: unknown; expires: number }>();
const inflight = new Map<string, Promise<unknown>>();

function readDb(key: string): { value: unknown; expires: number } | null {
  try {
    const row = getDb().prepare('SELECT value, expires_at FROM cache WHERE key = ?').get(key);
    if (!row) return null;
    return { value: JSON.parse(String(row.value)), expires: Number(row.expires_at) };
  } catch {
    return null;
  }
}

function writeDb(key: string, value: unknown, expires: number) {
  try {
    getDb()
      .prepare('INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at')
      .run(key, JSON.stringify(value), expires);
  } catch {
    /* cache is best-effort */
  }
}

export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const m = memory.get(key);
  if (m && m.expires > now) return m.value as T;
  const d = readDb(key);
  if (d && d.expires > now) {
    memory.set(key, d);
    return d.value as T;
  }
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = (async () => {
    try {
      const value = await load();
      const expires = Date.now() + ttlSeconds * 1000;
      memory.set(key, { value, expires });
      if (memory.size > 500) memory.delete(memory.keys().next().value as string);
      writeDb(key, value, expires);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function pruneCache() {
  try {
    getDb().prepare('DELETE FROM cache WHERE expires_at < ?').run(Date.now());
  } catch {
    /* ignore */
  }
}
