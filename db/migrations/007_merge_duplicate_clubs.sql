-- scripts/data-import/import-transfermarkt.ts only merges a club into an existing row when
-- its official transfermarkt name normalizes to an exact match. Where the original 16-player
-- hand-seed (scripts/seed-dev.ts) used a shorter/different name, both rows persisted as
-- separate clubs with separate player_clubs edges: most imported players' real transfer
-- edges point at the transfermarkt-derived row, while the small hand-seeded set (Ronaldinho,
-- Henry, etc.) pointed at the old short-named row. Whichever one a player picks in the UI
-- then determines whether a genuinely correct answer validates - found via real gameplay
-- testing (Henry -> Arsenal, Suarez -> Barcelona both rejected as "didn't play there" despite
-- being correct, because the two players' edges pointed at two different "Arsenal"/
-- "Barcelona" rows).
--
-- scripts/seed-dev.ts has been updated to use the official names going forward (so a future
-- db:reset-dev + db:import-transfermarkt cycle won't recreate these), but that doesn't touch
-- rows that already exist. This migration merges each known pair for the current database:
-- keeps the transfermarkt-derived row (where the bulk of real edges already live), repoints
-- the hand-seeded row's edges onto it (skipping any that would collide with the unique
-- (player_id, club_id, dataset_version_id, start_year, end_year) constraint - those are
-- exact duplicates of an edge that already exists on the winning row), then deletes the
-- now-empty hand-seeded row.
--
-- Includes Ajax/AS Roma/Bayer Leverkusen for completeness even though those were already
-- cleaned up by hand directly in the database during an earlier session - this makes the
-- migration a no-op for pairs that don't exist, rather than silently assuming that cleanup
-- is durable.

BEGIN;

DO $$
DECLARE
  pair RECORD;
  loser_id BIGINT;
  winner_id BIGINT;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('arsenal', 'arsenal fc'),
      ('barcelona', 'fc barcelona'),
      ('chelsea', 'chelsea fc'),
      ('juventus', 'juventus fc'),
      ('liverpool', 'liverpool fc'),
      ('ajax', 'ajax amsterdam'),
      ('as roma', 'associazione sportiva roma'),
      ('bayer leverkusen', 'bayer 04 leverkusen')
    ) AS t(loser_normalized, winner_normalized)
  LOOP
    SELECT id INTO loser_id FROM clubs WHERE normalized_name = pair.loser_normalized;
    SELECT id INTO winner_id FROM clubs WHERE normalized_name = pair.winner_normalized;

    IF loser_id IS NOT NULL AND winner_id IS NOT NULL THEN
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

      -- Anything left pointing at loser_id is an exact duplicate of an edge already moved
      -- onto winner_id (the NOT EXISTS guard above skipped it) - safe to drop.
      DELETE FROM player_clubs WHERE club_id = loser_id;
      DELETE FROM clubs WHERE id = loser_id;
    END IF;
  END LOOP;
END $$;

COMMIT;
