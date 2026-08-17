-- Root cause: player_clubs has composite indexes (player_id, dataset_version_id) and
-- (club_id, dataset_version_id) (001_v1_schema.sql:123-124), but neither has
-- dataset_version_id as a leading column. PgGraphRepository.loadPlayerClubEdges's
-- `WHERE pc.dataset_version_id = $1` (no player_id/club_id filter - it loads the whole
-- transfer graph for PgGraphService's adjacency map) can't use either index as a prefix, so it
-- fell back to a sequential scan of all 526,000+ player_clubs rows on every call. Found while
-- investigating why "reveal next steps" hints and the daily puzzle felt slow -
-- PgGraphService now caches the built adjacency map per warm Lambda instance (see
-- src/backend/services/graph/pg-graph.service.ts), so this scan is rare rather than
-- per-request, but it's still the right index for the query that remains.

BEGIN;

CREATE INDEX player_clubs_dataset_version_idx ON player_clubs(dataset_version_id);

COMMIT;
