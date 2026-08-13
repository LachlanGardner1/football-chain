-- Schema for the 1v1 "speed round" real-time race mode: pre-generated 3-anchor puzzles (see
-- scripts/puzzle-generation/generate-speed-round-pool.ts - generation is too slow to run
-- inline in a request, so matches always claim an existing pool row) and matches between two
-- anonymous sessions, paired via a shareable invite code.
--
-- Anchor players use the same join-table shape as daily_puzzle_players (006) rather than an
-- array column, for the same reason: referential integrity per player and no ordering to
-- encode (anchors may be visited in any order in this mode too).
--
-- Matches use two fixed player-slot columns (player_a_*/player_b_*) rather than a
-- match_players join table - a match is always exactly 2 players, so this avoids an extra join
-- on every poll (the state endpoint is hit ~once per second per active match).

BEGIN;

CREATE TABLE speed_round_puzzles (
  id BIGSERIAL PRIMARY KEY,
  dataset_version_id BIGINT NOT NULL REFERENCES data_versions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT speed_round_puzzles_used_count_nonnegative CHECK (used_count >= 0)
);

CREATE TABLE speed_round_puzzle_players (
  speed_round_puzzle_id BIGINT NOT NULL REFERENCES speed_round_puzzles(id) ON DELETE CASCADE,
  player_id BIGINT NOT NULL REFERENCES players(id),
  PRIMARY KEY (speed_round_puzzle_id, player_id)
);

CREATE TYPE speed_round_match_status AS ENUM (
  'WAITING_FOR_OPPONENT',
  'READY_COUNTDOWN',
  'IN_PROGRESS',
  'FINISHED',
  'CANCELLED'
);

CREATE TABLE speed_round_matches (
  id BIGSERIAL PRIMARY KEY,
  invite_code TEXT NOT NULL UNIQUE,
  puzzle_id BIGINT NOT NULL REFERENCES speed_round_puzzles(id),
  status speed_round_match_status NOT NULL DEFAULT 'WAITING_FOR_OPPONENT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,

  player_a_user_id UUID NOT NULL REFERENCES users(id),
  player_b_user_id UUID REFERENCES users(id),

  player_a_ready_at TIMESTAMPTZ,
  player_b_ready_at TIMESTAMPTZ,

  -- Updated on every state poll from that player - the forfeit rule (a finished player wins
  -- automatically if their opponent's heartbeat goes stale) reads off these, not a separate
  -- presence system.
  player_a_last_seen_at TIMESTAMPTZ,
  player_b_last_seen_at TIMESTAMPTZ,

  -- Server receipt time of a *validated* solve, not client-reported elapsed time - see
  -- SpeedRoundService. Duration is derived as finished_at - started_at, not stored separately.
  player_a_finished_at TIMESTAMPTZ,
  player_b_finished_at TIMESTAMPTZ,

  -- The actual solved chain, kept for the side-by-side summary screen after the match ends.
  player_a_chain JSONB,
  player_b_chain JSONB,

  winner_user_id UUID REFERENCES users(id),

  CONSTRAINT speed_round_matches_players_different CHECK (
    player_b_user_id IS NULL OR player_a_user_id <> player_b_user_id
  )
);

CREATE INDEX speed_round_matches_status_idx ON speed_round_matches(status);
CREATE INDEX speed_round_puzzle_players_puzzle_idx ON speed_round_puzzle_players(speed_round_puzzle_id);

COMMIT;
