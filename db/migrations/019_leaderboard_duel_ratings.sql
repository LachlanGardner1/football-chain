-- Duel (Speed Round) win/loss/rating tracking. A separate 1:1 table rather than new columns on
-- `users` - most players may never duel, and this keeps that optional state out of the shared
-- identity table every other mode also writes to. It also isolates the still-flat +50/-50
-- scheme from `users`' own migration history, so swapping in real ELO math later (K-factor,
-- opponent-rating-aware deltas, etc.) only ever touches this table. Rows are created lazily
-- (ON CONFLICT DO NOTHING) the first time a match involving that user actually resolves with a
-- winner - see applyRatingIfNeeded in speed-round.repository.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS user_duel_ratings (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  rating INTEGER NOT NULL DEFAULT 1000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_duel_ratings_wins_nonnegative CHECK (wins >= 0),
  CONSTRAINT user_duel_ratings_losses_nonnegative CHECK (losses >= 0)
);

CREATE INDEX IF NOT EXISTS user_duel_ratings_rating_idx ON user_duel_ratings(rating DESC);

-- Claims exactly one rating application per match. recordFinish() and the forfeit-timeout
-- branch inside getMatchState() both set winner_user_id/status='FINISHED' behind their own
-- COALESCE guards, but nothing stops the rating step from being *attempted* twice if both paths
-- ever fire for the same match. The rating-apply step claims this column via
-- `UPDATE ... WHERE rating_applied_at IS NULL RETURNING ...` inside the same transaction as the
-- winner-setting UPDATE, so it can never double-apply.
ALTER TABLE speed_round_matches
  ADD COLUMN IF NOT EXISTS rating_applied_at TIMESTAMPTZ;

COMMIT;
