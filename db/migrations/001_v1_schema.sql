-- v1 schema for Football Transfer Chain daily mode
-- PostgreSQL 14+

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE node_type AS ENUM ('PLAYER', 'CLUB');
CREATE TYPE puzzle_status AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE data_versions (
  id BIGSERIAL PRIMARY KEY,
  version_key TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT
);

CREATE TABLE players (
  id BIGSERIAL PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  dob DATE,
  country TEXT,
  position TEXT,
  source_entity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE clubs (
  id BIGSERIAL PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  country TEXT,
  source_entity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE player_clubs (
  id BIGSERIAL PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(id),
  club_id BIGINT NOT NULL REFERENCES clubs(id),
  start_year SMALLINT,
  end_year SMALLINT,
  source_name TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000,
  dataset_version_id BIGINT NOT NULL REFERENCES data_versions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_clubs_year_check CHECK (
    start_year IS NULL OR end_year IS NULL OR start_year <= end_year
  )
);

CREATE TABLE daily_puzzles (
  id BIGSERIAL PRIMARY KEY,
  puzzle_date DATE NOT NULL UNIQUE,
  start_player_id BIGINT NOT NULL REFERENCES players(id),
  target_player_id BIGINT NOT NULL REFERENCES players(id),
  optimal_length SMALLINT NOT NULL,
  dataset_version_id BIGINT NOT NULL REFERENCES data_versions(id),
  status puzzle_status NOT NULL DEFAULT 'DRAFT',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daily_puzzles_players_different CHECK (start_player_id <> target_player_id),
  CONSTRAINT daily_puzzles_optimal_length_check CHECK (optimal_length > 0)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT,
  auth_provider TEXT,
  auth_subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_identity_present CHECK (
    username IS NOT NULL OR (auth_provider IS NOT NULL AND auth_subject IS NOT NULL)
  )
);

CREATE UNIQUE INDEX users_auth_provider_subject_uq
  ON users(auth_provider, auth_subject)
  WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL;

CREATE TABLE game_results (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  puzzle_id BIGINT NOT NULL REFERENCES daily_puzzles(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  best_chain_length SMALLINT,
  solved BOOLEAN NOT NULL DEFAULT FALSE,
  hints_used SMALLINT NOT NULL DEFAULT 0,
  solved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT game_results_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT game_results_hints_nonnegative CHECK (hints_used >= 0),
  CONSTRAINT game_results_best_chain_positive CHECK (
    best_chain_length IS NULL OR best_chain_length > 0
  ),
  CONSTRAINT game_results_solved_requires_time CHECK (
    solved = FALSE OR solved_at IS NOT NULL
  ),
  CONSTRAINT game_results_user_puzzle_unique UNIQUE (user_id, puzzle_id)
);

CREATE TABLE user_streaks (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  current_streak INTEGER NOT NULL DEFAULT 0,
  max_streak INTEGER NOT NULL DEFAULT 0,
  last_solved_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_streaks_nonnegative CHECK (
    current_streak >= 0 AND max_streak >= 0
  )
);

CREATE INDEX players_normalized_name_idx ON players(normalized_name);
CREATE INDEX clubs_normalized_name_idx ON clubs(normalized_name);
CREATE INDEX player_clubs_player_version_idx ON player_clubs(player_id, dataset_version_id);
CREATE INDEX player_clubs_club_version_idx ON player_clubs(club_id, dataset_version_id);
CREATE INDEX daily_puzzles_date_status_idx ON daily_puzzles(puzzle_date, status);
CREATE INDEX game_results_puzzle_solved_idx ON game_results(puzzle_id, solved);
CREATE INDEX game_results_user_solved_at_idx ON game_results(user_id, solved_at DESC);

COMMIT;
