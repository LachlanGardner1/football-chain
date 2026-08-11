import { NextResponse } from 'next/server';
import { pgPool } from '../../../backend/repositories/postgres/db';

export async function GET() {
  const [playersRes, clubsRes] = await Promise.all([
    pgPool.query('SELECT id, canonical_name AS name FROM players ORDER BY id'),
    pgPool.query('SELECT id, canonical_name AS name FROM clubs ORDER BY id'),
  ]);

  return NextResponse.json({
    players: playersRes.rows.map((row) => ({ id: Number(row.id), name: row.name })),
    clubs: clubsRes.rows.map((row) => ({ id: Number(row.id), name: row.name })),
  });
}
