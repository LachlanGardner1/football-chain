-- Tracks which anchors have already had their "most time spent" club revealed for a given
-- (user, puzzle) attempt, via the hint button. Needed so a repeat hint request doesn't
-- re-show the same anchor's club, and so a page refresh doesn't lose progress or let a
-- player "refresh-fish" for a different reveal - see src/backend/services/hints/hint.service.ts.
-- game_results.hints_used (already exists, previously always 0) is the running count used
-- for the score penalty.

BEGIN;

CREATE TABLE anchor_club_hints (
  user_id UUID NOT NULL REFERENCES users(id),
  puzzle_id BIGINT NOT NULL REFERENCES daily_puzzles(id),
  anchor_player_id BIGINT NOT NULL REFERENCES players(id),
  club_id BIGINT NOT NULL REFERENCES clubs(id),
  revealed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, puzzle_id, anchor_player_id)
);

COMMIT;
