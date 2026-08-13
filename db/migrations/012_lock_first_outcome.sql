-- Supports "your first result each day is what counts": once a player's chain either
-- solves the puzzle or runs their score down to 0, that outcome is locked in permanently for
-- that (user, puzzle) pair - solved/best_chain_length/solved_at/failed_at never change again,
-- no matter how many more times they replay for fun afterward, and the streak only ever
-- reacts to that first locked result.
--
-- outcome_locked backfills to TRUE only for already-solved rows: under the old rules, a
-- solved row already represented "the recorded outcome" for that puzzle (even if
-- best_chain_length could previously have been improved by replaying - this doesn't
-- retroactively undo that, it only prevents it going forward). Existing unsolved rows (an
-- attempt that was never finished) stay unlocked, so picking that puzzle back up behaves like
-- a fresh attempt under the new rule rather than being retroactively - and arbitrarily -
-- treated as an already-decided loss.

BEGIN;

ALTER TABLE game_results
  ADD COLUMN IF NOT EXISTS outcome_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

UPDATE game_results SET outcome_locked = TRUE WHERE solved = TRUE;

COMMIT;
