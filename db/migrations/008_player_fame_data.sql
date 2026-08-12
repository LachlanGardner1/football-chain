-- Persists what scripts/data-import/import-transfermarkt.ts already parses to decide catalog
-- inclusion (peak market value, international caps) but previously discarded afterward.
-- Needed so puzzle generation can pick anchor players by how well-known they actually are,
-- rather than uniformly at random across everyone who cleared the (low) inclusion bar - see
-- scripts/puzzle-generation/rotate-puzzles.ts's ANCHOR_MIN_MARKET_VALUE_EUR/ANCHOR_MIN_CAPS.

BEGIN;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS peak_market_value_eur BIGINT,
  ADD COLUMN IF NOT EXISTS international_caps SMALLINT;

COMMIT;
