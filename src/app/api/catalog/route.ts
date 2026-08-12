import { NextResponse } from 'next/server';
import { pgPool } from '../../../backend/repositories/postgres/db';

export async function GET() {
  const versionResult = await pgPool.query<{ id: string }>(
    `SELECT id FROM data_versions WHERE is_active = TRUE ORDER BY imported_at DESC LIMIT 1`,
  );
  const datasetVersionId = versionResult.rows[0]?.id ?? null;

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

  return NextResponse.json({
    players: playersRes.rows.map((row) => ({ id: Number(row.id), name: row.name })),
    clubs: clubsRes.rows.map((row) => ({ id: Number(row.id), name: row.name })),
  });
}
