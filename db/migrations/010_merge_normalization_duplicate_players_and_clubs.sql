-- Root cause: normalizeName() (scripts/normalize-name.ts) was changed mid-session to strip
-- accents (fixing "Suarez" not matching "Suárez" in search). scripts/data-import/
-- import-transfermarkt.ts was then re-run to backfill the new peak_market_value_eur/
-- international_caps columns, and it recomputes normalized_name on every run - for any
-- accented name, the freshly-computed normalized_name no longer matched the original row's
-- (pre-fix) normalized_name, so `ON CONFLICT (normalized_name)` found nothing to update and
-- inserted a brand-new row instead. The result: 1,188 players and 108 clubs each ended up
-- with two rows under an identical canonical_name - one original (no fame data, since that
-- backfill never touched it) and one fresh duplicate (real fame data, but its own separate,
-- incomplete set of player_clubs edges). Found via real gameplay testing: a submitted link
-- (Columbus Crew -> Cristian Martínez) failed even though it was correct, because the
-- puzzle's anchor was one "Cristian Martínez" row while the Columbus Crew edge lived on the
-- other.
--
-- Verified before writing this migration: every single duplicate-name group (both tables) is
-- exactly a clean pair, and the more-recently-created row of each pair is always the one with
-- real fame data - so created_at reliably identifies which row to keep without needing a
-- hardcoded name list (unlike the different-root-cause club renames in migration 007). If
-- normalizeName() ever changes again in the future, a similar cleanup would be needed then
-- too - this migration only fixes the current, already-verified mess.

BEGIN;

-- === Players ===
DO $$
DECLARE
  dup RECORD;
  loser_id BIGINT;
  winner_id BIGINT;
BEGIN
  FOR dup IN
    SELECT canonical_name
    FROM players
    GROUP BY canonical_name
    HAVING COUNT(*) = 2
  LOOP
    SELECT id INTO winner_id FROM players WHERE canonical_name = dup.canonical_name ORDER BY created_at DESC LIMIT 1;
    SELECT id INTO loser_id FROM players WHERE canonical_name = dup.canonical_name AND id <> winner_id LIMIT 1;

    UPDATE player_clubs pc
    SET player_id = winner_id
    WHERE pc.player_id = loser_id
      AND NOT EXISTS (
        SELECT 1 FROM player_clubs pc2
        WHERE pc2.player_id = winner_id
          AND pc2.club_id = pc.club_id
          AND pc2.dataset_version_id = pc.dataset_version_id
          AND pc2.start_year IS NOT DISTINCT FROM pc.start_year
          AND pc2.end_year IS NOT DISTINCT FROM pc.end_year
      );
    DELETE FROM player_clubs WHERE player_id = loser_id;

    UPDATE daily_puzzle_players dpp
    SET player_id = winner_id
    WHERE dpp.player_id = loser_id
      AND NOT EXISTS (
        SELECT 1 FROM daily_puzzle_players dpp2
        WHERE dpp2.daily_puzzle_id = dpp.daily_puzzle_id AND dpp2.player_id = winner_id
      );
    DELETE FROM daily_puzzle_players WHERE player_id = loser_id;

    UPDATE anchor_club_hints ach
    SET anchor_player_id = winner_id
    WHERE ach.anchor_player_id = loser_id
      AND NOT EXISTS (
        SELECT 1 FROM anchor_club_hints ach2
        WHERE ach2.user_id = ach.user_id AND ach2.puzzle_id = ach.puzzle_id AND ach2.anchor_player_id = winner_id
      );
    DELETE FROM anchor_club_hints WHERE anchor_player_id = loser_id;

    DELETE FROM players WHERE id = loser_id;
  END LOOP;
END $$;

-- === Clubs ===
DO $$
DECLARE
  dup RECORD;
  loser_id BIGINT;
  winner_id BIGINT;
BEGIN
  FOR dup IN
    SELECT canonical_name
    FROM clubs
    GROUP BY canonical_name
    HAVING COUNT(*) = 2
  LOOP
    SELECT id INTO winner_id FROM clubs WHERE canonical_name = dup.canonical_name ORDER BY created_at DESC LIMIT 1;
    SELECT id INTO loser_id FROM clubs WHERE canonical_name = dup.canonical_name AND id <> winner_id LIMIT 1;

    UPDATE player_clubs pc
    SET club_id = winner_id
    WHERE pc.club_id = loser_id
      AND NOT EXISTS (
        SELECT 1 FROM player_clubs pc2
        WHERE pc2.club_id = winner_id
          AND pc2.player_id = pc.player_id
          AND pc2.dataset_version_id = pc.dataset_version_id
          AND pc2.start_year IS NOT DISTINCT FROM pc.start_year
          AND pc2.end_year IS NOT DISTINCT FROM pc.end_year
      );
    DELETE FROM player_clubs WHERE club_id = loser_id;

    UPDATE anchor_club_hints SET club_id = winner_id WHERE club_id = loser_id;

    DELETE FROM clubs WHERE id = loser_id;
  END LOOP;
END $$;

COMMIT;
