// Caché HTTP con vencimiento en un SQLite propio (efímero, no se versiona).
// Las entradas vencidas se conservan un tiempo para usarlas como respaldo explícito.

import { openDatabase, type Db } from '../../db/connection.ts';

export interface CachedResponse {
  body: string;
  fetchedAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface HttpCache {
  get(key: string, now?: Date): CachedResponse | undefined;
  set(key: string, url: string, body: string, ttlSeconds: number, now?: Date): void;
  purge(olderThanDays: number, now?: Date): number;
}

export class SqliteHttpCache implements HttpCache {
  #db: Db;

  constructor(path: string) {
    this.#db = openDatabase(path);
    this.#db.exec(`CREATE TABLE IF NOT EXISTS http_cache (
      key TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      body TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`);
  }

  get(key: string, now = new Date()): CachedResponse | undefined {
    const row = this.#db.prepare('SELECT body, fetched_at, expires_at FROM http_cache WHERE key = ?').get(key) as
      | { body: string; fetched_at: string; expires_at: string }
      | undefined;
    if (!row) return undefined;
    return { body: row.body, fetchedAt: row.fetched_at, expiresAt: row.expires_at, expired: row.expires_at <= now.toISOString() };
  }

  set(key: string, url: string, body: string, ttlSeconds: number, now = new Date()): void {
    const expires = new Date(now.getTime() + ttlSeconds * 1000);
    this.#db
      .prepare(
        `INSERT INTO http_cache (key, url, body, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET url = excluded.url, body = excluded.body,
           fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
      )
      .run(key, url, body, now.toISOString(), expires.toISOString());
  }

  purge(olderThanDays: number, now = new Date()): number {
    const limit = new Date(now.getTime() - olderThanDays * 86_400_000).toISOString();
    return Number(this.#db.prepare('DELETE FROM http_cache WHERE expires_at < ?').run(limit).changes);
  }

  close(): void {
    this.#db.close();
  }
}

/** Caché en memoria para pruebas. */
export class MemoryHttpCache implements HttpCache {
  #entries = new Map<string, { body: string; fetchedAt: string; expiresAt: string }>();

  get(key: string, now = new Date()): CachedResponse | undefined {
    const e = this.#entries.get(key);
    return e ? { ...e, expired: e.expiresAt <= now.toISOString() } : undefined;
  }

  set(key: string, _url: string, body: string, ttlSeconds: number, now = new Date()): void {
    this.#entries.set(key, {
      body,
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    });
  }

  purge(): number {
    return 0;
  }
}
