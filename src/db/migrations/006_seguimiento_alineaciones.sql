-- Seguimiento de la búsqueda de alineaciones de cada partido, para avisar una sola vez:
-- al empezar a buscarlas y al cerrar (publicadas a tiempo o nunca aparecieron).
CREATE TABLE lineup_watch (
  match_id INTEGER PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  closed_at TEXT,
  outcome TEXT CHECK (outcome IN ('encontradas', 'sin-alineaciones'))
);
