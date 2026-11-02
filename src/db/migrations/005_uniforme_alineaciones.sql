-- Colores de la camiseta que usa cada equipo en el partido (los informa ESPN junto a la alineación).
ALTER TABLE match_lineups ADD COLUMN kit_color TEXT;
ALTER TABLE match_lineups ADD COLUMN kit_detail TEXT;
