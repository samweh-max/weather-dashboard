import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

/**
 * SQLite storage using Node's built-in `node:sqlite` (Node 22.13+), so there is no
 * native module to compile. Holds the API response cache and imported datasets.
 */

type Stmt = {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
};
export interface Db {
  exec: (sql: string) => void;
  prepare: (sql: string) => Stmt;
}

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;
  const sqlite = process.getBuiltinModule?.('node:sqlite') as
    | { DatabaseSync: new (file: string) => Db }
    | undefined;
  if (!sqlite) throw new Error('node:sqlite is not available. Use Node.js 22.13 or newer.');
  const file = process.env.WEATHER_DB_PATH || path.join(process.cwd(), 'data', 'weather.db');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new sqlite.DatabaseSync(file);
  conn.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      meta TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db = conn;
  return db;
}
