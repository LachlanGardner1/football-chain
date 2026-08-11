-- Replaces the fixed start/target players and the ordered, comma-separated
-- required_player_ids/required_player_names text columns with an unordered
-- anchor-player set: the puzzle names 3-5 players, the solver chooses which
-- order to visit them in is up to the player (any anchor may be the start or
-- the end), so there is no "position" to store here.

BEGIN;

-- Depends on the columns being dropped below; recreated in the new shape after.
DROP VIEW IF EXISTS v_published_daily_puzzles;

CREATE TABLE daily_puzzle_players (
  daily_puzzle_id BIGINT NOT NULL REFERENCES daily_puzzles(id) ON DELETE CASCADE,
  player_id BIGINT NOT NULL REFERENCES players(id),
  PRIMARY KEY (daily_puzzle_id, player_id)
);

ALTER TABLE daily_puzzles
  DROP CONSTRAINT IF EXISTS daily_puzzles_players_different,
  DROP COLUMN IF EXISTS start_player_id,
  DROP COLUMN IF EXISTS target_player_id,
  DROP COLUMN IF EXISTS required_player_ids,
  DROP COLUMN IF EXISTS required_player_names;

CREATE VIEW v_published_daily_puzzles AS
SELECT
  p.id,
  p.puzzle_date,
  p.optimal_length,
  p.dataset_version_id,
  p.published_at,
  array_agg(pl.canonical_name ORDER BY pl.canonical_name) AS anchor_player_names
FROM daily_puzzles p
JOIN daily_puzzle_players dpp ON dpp.daily_puzzle_id = p.id
JOIN players pl ON pl.id = dpp.player_id
WHERE p.status = 'PUBLISHED'
GROUP BY p.id;

COMMIT;
