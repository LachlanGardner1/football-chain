BEGIN;

ALTER TABLE daily_puzzles
  ADD COLUMN IF NOT EXISTS required_player_ids TEXT,
  ADD COLUMN IF NOT EXISTS required_player_names TEXT;

COMMIT;
