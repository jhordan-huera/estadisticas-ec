-- Esquema base: competiciones, equipos, jugadores, partidos y eventos.
-- Todas las fechas se guardan como texto ISO 8601 en UTC.

CREATE TABLE competitions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('liga', 'copa'))
);

CREATE TABLE seasons (
  id INTEGER PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  year INTEGER NOT NULL,
  UNIQUE (competition_id, year)
);

CREATE TABLE stages (
  id INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('league', 'groups', 'knockout')),
  ord INTEGER NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  UNIQUE (season_id, external_id)
);

CREATE TABLE stage_groups (
  id INTEGER PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (stage_id, external_id)
);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  abbr TEXT NOT NULL,
  color TEXT,
  alt_color TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE team_provider_ids (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  provider_name TEXT NOT NULL,
  PRIMARY KEY (provider, external_id)
);

CREATE TABLE group_teams (
  group_id INTEGER NOT NULL REFERENCES stage_groups(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  PRIMARY KEY (group_id, team_id)
);

CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  team_id INTEGER REFERENCES teams(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE player_provider_ids (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id),
  PRIMARY KEY (provider, external_id)
);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  group_id INTEGER REFERENCES stage_groups(id),
  round INTEGER,
  round_label TEXT,
  round_source TEXT CHECK (round_source IN ('provider', 'inferred', 'manual')),
  home_team_id INTEGER NOT NULL REFERENCES teams(id),
  away_team_id INTEGER NOT NULL REFERENCES teams(id),
  kickoff_utc TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'finished', 'postponed', 'suspended', 'cancelled')),
  status_detail TEXT,
  home_score INTEGER,
  away_score INTEGER,
  home_pens INTEGER,
  away_pens INTEGER,
  decided_by TEXT CHECK (decided_by IN ('regular', 'extra_time', 'penalties')),
  winner_team_id INTEGER REFERENCES teams(id),
  venue TEXT,
  city TEXT,
  events_complete INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (provider, external_id)
);

CREATE INDEX matches_stage_round ON matches (stage_id, round);
CREATE INDEX matches_kickoff ON matches (kickoff_utc);
CREATE INDEX matches_home ON matches (home_team_id);
CREATE INDEX matches_away ON matches (away_team_id);

CREATE TABLE match_events (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('goal', 'own_goal', 'penalty_goal', 'yellow_card', 'red_card')),
  minute INTEGER,
  added_time INTEGER,
  minute_label TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  player_id INTEGER REFERENCES players(id),
  UNIQUE (match_id, seq)
);

CREATE INDEX match_events_player ON match_events (player_id, kind);

-- Tabla publicada por el proveedor; solo sirve para contrastar la que calculamos.
CREATE TABLE provider_standings (
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  group_id INTEGER REFERENCES stage_groups(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  played INTEGER,
  points INTEGER,
  goals_for INTEGER,
  goals_against INTEGER,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (stage_id, team_id)
);

-- Correcciones manuales de jornada (tienen prioridad sobre la inferencia).
CREATE TABLE round_overrides (
  match_id INTEGER PRIMARY KEY REFERENCES matches(id),
  round INTEGER NOT NULL,
  note TEXT
);

-- Sanciones o bonificaciones de puntos decididas fuera de la cancha.
CREATE TABLE point_adjustments (
  id INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  effective_from TEXT NOT NULL
);

-- Anomalías de datos: nunca se descartan en silencio, se registran aquí.
CREATE TABLE data_issues (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  code TEXT NOT NULL,
  entity_ref TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (source, code, entity_ref)
);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  summary TEXT
);
