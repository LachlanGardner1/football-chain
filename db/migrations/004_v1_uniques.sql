BEGIN;

ALTER TABLE players
  ADD CONSTRAINT players_normalized_name_uq UNIQUE (normalized_name);

ALTER TABLE clubs
  ADD CONSTRAINT clubs_normalized_name_uq UNIQUE (normalized_name);

ALTER TABLE player_clubs
  ADD CONSTRAINT player_clubs_unique_edge
  UNIQUE (player_id, club_id, dataset_version_id, start_year, end_year);

COMMIT;
