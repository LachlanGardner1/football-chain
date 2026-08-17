import { NextResponse, type NextRequest } from 'next/server';
import { pgPool } from '../../../../../backend/repositories/postgres/db';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);

  if (!Number.isInteger(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Invalid player id.' }, { status: 400 });
  }

  const versionResult = await pgPool.query<{ id: string }>(
    `SELECT id FROM data_versions WHERE is_active = TRUE ORDER BY imported_at DESC LIMIT 1`,
  );
  const datasetVersionId = versionResult.rows[0]?.id ?? null;

  const clubsRes = await pgPool.query<{ id: string; name: string }>(
    `SELECT DISTINCT c.id, c.canonical_name AS name
     FROM clubs c
     JOIN player_clubs pc ON pc.club_id = c.id AND pc.dataset_version_id = $1
     WHERE pc.player_id = $2
     ORDER BY c.canonical_name`,
    [datasetVersionId, playerId],
  );

  return NextResponse.json({
    clubs: clubsRes.rows.map((row) => ({ id: Number(row.id), name: row.name })),
  });
}
