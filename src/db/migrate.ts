// Migraciones simples: archivos NNN_nombre.sql aplicados en orden, cada uno en su transacción.
// Se guarda el hash de cada archivo; si una migración ya aplicada cambia, se detiene con error.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AppError } from '../core/errors.ts';
import { sha256 } from '../core/text.ts';
import type { Logger } from '../core/logger.ts';
import { many, nowIso, run, type Db } from './connection.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

interface AppliedRow {
  version: number;
  name: string;
  checksum: string;
}

export function migrate(db: Db, logger: Logger, dir = MIGRATIONS_DIR): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Map(many<AppliedRow>(db, 'SELECT version, name, checksum FROM schema_migrations').map((r) => [r.version, r]));
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort();

  const newlyApplied: number[] = [];
  for (const file of files) {
    const version = Number(file.slice(0, 3));
    const sql = readFileSync(join(dir, file), 'utf8');
    const checksum = sha256(sql);
    const previous = applied.get(version);
    if (previous) {
      if (previous.checksum !== checksum) {
        throw new AppError('MIGRATION_CHANGED', `La migración ${file} ya fue aplicada y su contenido cambió`, { version });
      }
      continue;
    }
    // Recrear una tabla (p. ej. para cambiar un CHECK) exige desactivar las claves foráneas
    // fuera de la transacción; la migración lo pide con un comentario y se verifica al final.
    const foreignKeysOff = /^--\s*requiere:\s*foreign_keys=OFF/m.test(sql);
    if (foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      if (foreignKeysOff) {
        const broken = many<Record<string, unknown>>(db, 'PRAGMA foreign_key_check');
        if (broken.length) throw new Error(`${broken.length} referencias rotas tras la migración`);
      }
      run(db, 'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (:v, :n, :c, :t)', {
        v: version,
        n: file,
        c: checksum,
        t: nowIso(),
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new AppError('MIGRATION_FAILED', `Falló la migración ${file}`, { error: String(err) }, { cause: err });
    } finally {
      if (foreignKeysOff) db.exec('PRAGMA foreign_keys = ON');
    }
    logger.info(`Migración aplicada: ${file}`);
    newlyApplied.push(version);
  }
  return newlyApplied;
}
