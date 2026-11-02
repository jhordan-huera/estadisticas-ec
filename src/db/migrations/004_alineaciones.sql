-- requiere: foreign_keys=OFF
-- Alineaciones por partido y nuevo tipo de publicación "alineaciones".

CREATE TABLE match_lineups (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  formation TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (match_id, team_id)
);

CREATE TABLE lineup_players (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  name TEXT NOT NULL,
  jersey TEXT,
  position TEXT,
  formation_place INTEGER,
  starter INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id)
);

-- SQLite no permite modificar un CHECK: se recrea la cola con el tipo nuevo (procedimiento oficial).
CREATE TABLE posts_nueva (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('cartelera', 'resultado', 'resumen', 'tabla', 'goleadores', 'equipo', 'duelo', 'alineaciones')),
  dedupe_key TEXT NOT NULL UNIQUE,
  competition_code TEXT NOT NULL,
  season INTEGER NOT NULL,
  subject TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'rendered', 'published', 'failed', 'skipped', 'expired')),
  scheduled_for TEXT NOT NULL,
  expires_at TEXT,
  series TEXT,
  fingerprint TEXT,
  caption TEXT,
  alt_text TEXT,
  situation TEXT,
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

INSERT INTO posts_nueva (id, kind, dedupe_key, competition_code, season, subject, priority, status, scheduled_for, expires_at,
  series, fingerprint, caption, alt_text, situation, media, attempts, last_error, mode, external_id, permalink, note,
  created_at, updated_at, rendered_at, published_at)
SELECT id, kind, dedupe_key, competition_code, season, subject, priority, status, scheduled_for, expires_at,
  series, fingerprint, caption, alt_text, situation, media, attempts, last_error, mode, external_id, permalink, note,
  created_at, updated_at, rendered_at, published_at
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_nueva RENAME TO posts;

CREATE INDEX posts_queue ON posts (status, priority, scheduled_for);
CREATE INDEX posts_published ON posts (published_at);
CREATE INDEX posts_series ON posts (series, status);
