-- Persists the score at the moment a puzzle's outcome locks in (see 012_lock_first_outcome.sql)
-- so "You already solved/played today's puzzle" can show the actual official score without
-- trying to reconstruct it later from ephemeral client-only inputs (invalid submission count,
-- hint timing) that aren't otherwise stored per attempt.

BEGIN;

ALTER TABLE game_results
  ADD COLUMN IF NOT EXISTS locked_score SMALLINT;

ALTER TABLE game_results
  ADD CONSTRAINT game_results_locked_score_nonnegative CHECK (locked_score IS NULL OR locked_score >= 0);

COMMIT;
