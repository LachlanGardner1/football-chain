-- A player-chosen public display name, kept separate from `username` (which is only ever an
-- auto-generated FK-safety placeholder like `user-<uuid8>`, written unconditionally by three
-- different repositories' ensureUser-style upserts the moment a users row is first needed - see
-- game-result.repository.ts, hint.repository.ts, speed-round.repository.ts). Repurposing
-- `username` would mean every leaderboard read has to guess whether a stored value is a real
-- choice or that auto-generated placeholder; a new nullable column keeps NULL an unambiguous
-- "hasn't set one yet" signal instead.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE users
  ADD CONSTRAINT users_display_name_length CHECK (
    display_name IS NULL
    OR (length(btrim(display_name)) BETWEEN 1 AND 24 AND display_name = btrim(display_name))
  );

-- Every daily leaderboard read is `WHERE puzzle_id = ? AND outcome_locked = TRUE
-- ORDER BY locked_score DESC` - a partial index covering exactly that shape.
CREATE INDEX IF NOT EXISTS game_results_leaderboard_idx
  ON game_results (puzzle_id, locked_score DESC)
  WHERE outcome_locked = TRUE;

COMMIT;
