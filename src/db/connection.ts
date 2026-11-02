import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type Db = DatabaseSync;
export type Params = Record<string, SQLInputValue>;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // journal_mode=DELETE deja un único archivo .sqlite, apto para versionarlo en la rama "estado".
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function one<T>(db: Db, sql: string, params: Params = {}): T | undefined {
  return db.prepare(sql).get(params) as T | undefined;
}

export function many<T>(db: Db, sql: string, params: Params = {}): T[] {
  return db.prepare(sql).all(params) as T[];
}

export function run(db: Db, sql: string, params: Params = {}): { changes: number; lastId: number } {
  const res = db.prepare(sql).run(params);
  return { changes: Number(res.changes), lastId: Number(res.lastInsertRowid) };
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
