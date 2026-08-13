-- Persists what clubs.csv (from scripts/data-import/import-transfermarkt.ts) already carries
-- but has only ever been used transiently to look up clubs.country - the raw competition code
-- itself (e.g. GB1/ES1/FR1/IT1/L1 for the "top 5" European leagues) was discarded after that
-- lookup. Needed so the speed-round mode can restrict anchor selection to players who've played
-- in one of those leagues, without inventing a new data source - see
-- scripts/puzzle-generation/generate-speed-round-pool.ts.

BEGIN;

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS domestic_competition_id TEXT;

COMMIT;
