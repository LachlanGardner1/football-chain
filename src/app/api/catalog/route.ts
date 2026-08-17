import { NextResponse } from 'next/server';
import { pgPool } from '../../../backend/repositories/postgres/db';

type CatalogBody = { players: Array<{ id: number; name: string }>; clubs: Array<{ id: number; name: string }> };

// Module-level cache, reused across warm invocations of the same Lambda instance (same
// pattern as pgPool in ../../../backend/repositories/postgres/db.ts). The full catalog only
// changes when a new dataset version is published, so re-querying and re-shipping ~7,000+ rows
// on every single page load was pure waste. Keyed by datasetVersionId so a real version change
// invalidates it automatically; the TTL on top is insurance against corrective migrations that
// UPDATE players/clubs rows in place without bumping dataset_version_id (this repo has
// precedent for that: db/migrations/007_merge_duplicate_clubs.sql,
// 020_merge_duplicate_club_name_variants.sql). Worst case on a stale hit is a just-renamed/
// merged club briefly showing old data in the autocomplete - never a correctness issue, since
// chain validation doesn't read this cache.
let cache: { datasetVersionId: string | null; body: CatalogBody; cachedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET() {
  const versionResult = await pgPool.query<{ id: string }>(
    `SELECT id FROM data_versions WHERE is_active = TRUE ORDER BY imported_at DESC LIMIT 1`,
  );
  const datasetVersionId = versionResult.rows[0]?.id ?? null;

  if (cache && cache.datasetVersionId === datasetVersionId && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json(cache.body);
  }

  // Only offer players/clubs that actually have at least one transfer edge in the active
  // dataset - a player who has no edges at all can never validate successfully no matter what
  // real, historically-correct answer is typed. This is a genuine source-data gap (found via
  // real gameplay testing: Xabi Alonso has real fame data from players.csv but zero rows in
  // transfers.csv at all - likely because the transfermarkt-datasets snapshot prioritizes
  // currently-active squads and he's now a manager, not a player), not something a data merge
  // can fix, so the catalog just shouldn't advertise players it can never confirm a link for.
  const [playersRes, clubsRes] = await Promise.all([
    pgPool.query(
      `SELECT DISTINCT p.id, p.canonical_name AS name
       FROM players p
       JOIN player_clubs pc ON pc.player_id = p.id AND pc.dataset_version_id = $1
       ORDER BY p.id`,
      [datasetVersionId],
    ),
    pgPool.query(
      `SELECT DISTINCT c.id, c.canonical_name AS name
       FROM clubs c
       JOIN player_clubs pc ON pc.club_id = c.id AND pc.dataset_version_id = $1
       ORDER BY c.id`,
      [datasetVersionId],
    ),
  ]);

  const body: CatalogBody = {
    players: playersRes.rows.map((row) => ({ id: Number(row.id), name: row.name })),
    clubs: clubsRes.rows.map((row) => ({ id: Number(row.id), name: row.name })),
  };
  cache = { datasetVersionId, body, cachedAt: Date.now() };

  return NextResponse.json(body);
}
