-- Root cause: scripts/data-import/import-wikidata.ts (and, before it,
-- import-transfermarkt.ts's transfers.csv vs. player_valuations.csv fallback) matches an
-- existing club only on an exact normalized_name string match, by design (its own comment:
-- "existing players/clubs are matched (never mutated)" - no fuzzy matching). Wikidata's
-- official long-form names ("Manchester United F.C.", "Football Club Seoul") don't
-- normalized-name-match transfermarkt's shorter colloquial names ("Manchester United",
-- "FC Seoul") for the same real club, so each import created a second club row instead of
-- reusing the first - the same class of bug already fixed twice for exact-string duplicates
-- (007_merge_duplicate_clubs.sql, 010_merge_normalization_duplicate_players_and_clubs.sql),
-- just with a name-variant mismatch instead of an exact one. Found via real gameplay testing
-- while building the "pick your next club from a dropdown of this player's real clubs"
-- feature: Jesse Lingard's club list showed "Manchester United" and "Manchester United F.C."
-- as two separate, independently-selectable options for what is obviously one real club.
--
-- Unlike 007 (a short, hand-verified list of 8 known pairs), this strips common club-type
-- tokens ("F.C.", "Football Club", "AC", "CD", ...) from every club's canonical_name and
-- groups whatever collides - there are 1000+ such pairs across the full imported dataset, far
-- too many to enumerate by hand. A group is only merged automatically when every non-null
-- country value in it agrees (or all are null) - this is deliberately conservative: a lot of
-- generic single-word club names ("Arsenal", "Port", "Liverpool") collide by coincidence
-- across countries once the club-type tokens are stripped (Arsenal FC England vs. Arsenal
-- Lesotho; Port FC Thailand vs. AS Port Djibouti), and those are genuinely different clubs
-- that must NOT be merged. Verified directly against this database before writing this
-- migration: of ~1050 stripped-name collisions, ~980 are country-consistent (or country-blank
-- on at least one side) and safe to auto-merge; the ~40-45 conflicting-country groups are left
-- untouched. Doesn't accent-fold (e.g. an unaccented "Dragon" wouldn't match an accented
-- "Dragón") - Postgres has no built-in accent folding without the unaccent extension, and
-- every case checked here already has consistent accenting on both sides, so this is a scope
-- limitation, not a known miss.
--
-- Winner per group = whichever row already has the most real player_clubs edges (least data to
-- move, matches 007's precedent of keeping "the row with the bulk of real edges"), tie-broken
-- by created_at then id for determinism. Since edge count has nothing to do with which row
-- happens to carry country/domestic_competition_id (the latter drives speed-round anchor
-- eligibility - see scripts/puzzle-generation/generate-speed-round-pool.ts), those two columns
-- are backfilled onto the winner from any group member that has them before the losers are
-- deleted, so a merge can never regress that data even when the richer-metadata row loses on
-- edge count (as happens here: e.g. "Manchester United F.C." ends up the edge-count winner
-- over "Manchester United" itself).

BEGIN;

CREATE TEMP TABLE club_dup_plan AS
WITH normalized AS (
  SELECT
    c.id,
    c.country,
    c.domestic_competition_id,
    c.created_at,
    COUNT(pc.id) AS edge_count,
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              replace(lower(c.canonical_name), '&', 'and'),
              '[.''-]', '', 'g'
            ),
            '\y(football club|fussball club|fussballclub|club de futbol|futbol club|soccer club)\y', '', 'g'
          ),
          '\y(fc|cf|sc|afc|ac|cd|ud|sd|rc|us|as)\y', '', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ) AS stripped_name
  FROM clubs c
  LEFT JOIN player_clubs pc ON pc.club_id = c.id
  GROUP BY c.id
),
groups AS (
  SELECT stripped_name
  FROM normalized
  WHERE stripped_name <> ''
  GROUP BY stripped_name
  HAVING COUNT(*) > 1
     AND COUNT(DISTINCT country) FILTER (WHERE country IS NOT NULL) <= 1
),
ranked AS (
  SELECT
    n.id,
    n.country,
    n.domestic_competition_id,
    FIRST_VALUE(n.id) OVER (
      PARTITION BY n.stripped_name
      ORDER BY n.edge_count DESC, n.created_at ASC, n.id ASC
    ) AS winner_id
  FROM normalized n
  JOIN groups g ON g.stripped_name = n.stripped_name
)
SELECT id, winner_id, country, domestic_competition_id
FROM ranked;

-- Backfill country / domestic_competition_id onto the winner from any group member that has
-- them - must run before the losers are deleted below.
UPDATE clubs c
SET
  country = COALESCE(c.country, filled.country),
  domestic_competition_id = COALESCE(c.domestic_competition_id, filled.domestic_competition_id),
  updated_at = NOW()
FROM (
  SELECT
    winner_id,
    MIN(country) FILTER (WHERE country IS NOT NULL) AS country,
    MIN(domestic_competition_id) FILTER (WHERE domestic_competition_id IS NOT NULL) AS domestic_competition_id
  FROM club_dup_plan
  GROUP BY winner_id
) filled
WHERE c.id = filled.winner_id
  AND (c.country IS NULL OR c.domestic_competition_id IS NULL);

-- Repoint real transfer edges onto the winner, skipping anything that would collide with an
-- edge the winner already has (same player/dataset/start/end - an exact duplicate).
UPDATE player_clubs pc
SET club_id = p.winner_id
FROM club_dup_plan p
WHERE pc.club_id = p.id
  AND p.id <> p.winner_id
  AND NOT EXISTS (
    SELECT 1 FROM player_clubs pc2
    WHERE pc2.club_id = p.winner_id
      AND pc2.player_id = pc.player_id
      AND pc2.dataset_version_id = pc.dataset_version_id
      AND pc2.start_year IS NOT DISTINCT FROM pc.start_year
      AND pc2.end_year IS NOT DISTINCT FROM pc.end_year
  );

-- Anything left pointing at a loser is an exact duplicate of an edge already moved onto the
-- winner - safe to drop.
DELETE FROM player_clubs pc
USING club_dup_plan p
WHERE pc.club_id = p.id AND p.id <> p.winner_id;

-- club_id isn't part of anchor_club_hints' primary key (user_id, puzzle_id, anchor_player_id),
-- so repointing it can never collide with an existing row.
UPDATE anchor_club_hints ach
SET club_id = p.winner_id
FROM club_dup_plan p
WHERE ach.club_id = p.id AND p.id <> p.winner_id;

DELETE FROM clubs c
USING club_dup_plan p
WHERE c.id = p.id AND p.id <> p.winner_id;

DROP TABLE club_dup_plan;

COMMIT;
