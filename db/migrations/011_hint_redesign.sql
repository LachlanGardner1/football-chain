-- Supports the redesigned hint system: a per-anchor "reveal a club" button that can be
-- pressed repeatedly (cycling through every club that anchor has played for, one per press)
-- instead of the old one-club-then-done-with-this-anchor model, plus a separate "reveal the
-- next two steps" button.
--
-- anchor_club_hints previously allowed only one revealed club per anchor (the primary key
-- included anchor_player_id but not club_id) - widening it to include club_id is what makes
-- multiple distinct club reveals per anchor possible; a repeat press for a club already
-- revealed still collides on the same key and is a no-op via ON CONFLICT DO NOTHING.
--
-- next_step_hints_used tracks the separate "reveal next two steps" hint's press count per
-- attempt, the same way game_results.hints_used already tracked hints generically - this one
-- needs its own counter because that button now has a different point cost (150 vs the
-- per-club-reveal button's 50) and no longer shares a single flat rate.

BEGIN;

ALTER TABLE anchor_club_hints DROP CONSTRAINT anchor_club_hints_pkey;
ALTER TABLE anchor_club_hints ADD PRIMARY KEY (user_id, puzzle_id, anchor_player_id, club_id);

ALTER TABLE game_results
  ADD COLUMN IF NOT EXISTS next_step_hints_used SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE game_results
  ADD CONSTRAINT game_results_next_step_hints_nonnegative CHECK (next_step_hints_used >= 0);

COMMIT;
