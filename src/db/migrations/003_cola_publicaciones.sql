-- Cola persistente de publicaciones y huellas del último contenido publicado.

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('cartelera', 'resultado', 'resumen', 'tabla', 'goleadores', 'equipo', 'duelo')),
  -- Clave única de lo que se publica (p. ej. resultado:serie-a:401921345): evita duplicados.
  dedupe_key TEXT NOT NULL UNIQUE,
  competition_code TEXT NOT NULL,
  season INTEGER NOT NULL,
  -- Referencia al contenido, en JSON: {"matchId":…} | {"stageId":…,"round":…} | {"teamId":…}
  subject TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'rendered', 'published', 'failed', 'skipped', 'expired')),
  scheduled_for TEXT NOT NULL,
  expires_at TEXT,
  -- Serie de contenido que se reemplaza a sí misma (tabla, goleadores): solo vale la última versión.
  series TEXT,
  fingerprint TEXT,
  caption TEXT,
  alt_text TEXT,
  situation TEXT,
  -- Archivos generados, en JSON: [{"format":"vertical","png":"…","jpg":"…"}]
  media TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  mode TEXT,
  external_id TEXT,
  permalink TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rendered_at TEXT,
  published_at TEXT
);

CREATE INDEX posts_queue ON posts (status, priority, scheduled_for);
CREATE INDEX posts_published ON posts (published_at);
CREATE INDEX posts_series ON posts (series, status);

-- Huella del último contenido publicado por serie (tabla, goleadores): publicar solo si cambió.
CREATE TABLE content_snapshots (
  series TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  post_id INTEGER REFERENCES posts(id),
  updated_at TEXT NOT NULL
);
