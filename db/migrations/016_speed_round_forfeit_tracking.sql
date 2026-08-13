-- Distinguishes a match that FINISHED because someone actually crossed the finish line first
-- (the normal case - the loser may still be actively racing and is allowed to keep submitting
-- afterward purely to record their own time for the summary screen) from one resolved via the
-- forfeit-timeout path (the opponent's heartbeat went stale before finishing at all). Both
-- paths set status='FINISHED' and winner_user_id, so without this there was no way to tell
-- them apart - a normal in-progress loser and an actually-forfeited opponent looked identical.

BEGIN;

ALTER TABLE speed_round_matches
  ADD COLUMN IF NOT EXISTS forfeited_slot TEXT CHECK (forfeited_slot IN ('a', 'b'));

COMMIT;
