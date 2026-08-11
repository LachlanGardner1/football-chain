import type { GraphRepository } from "../../domain/repositories";
import { pgPool } from "./db";

export class PgGraphRepository implements GraphRepository {
  async getActiveDatasetVersionId(): Promise<number> {
    const result = await pgPool.query<{ id: number }>(
      `SELECT id
       FROM data_versions
       WHERE is_active = TRUE
       ORDER BY imported_at DESC
       LIMIT 1`,
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("No active dataset version found.");
    }

    return row.id;
  }

  async loadPlayerClubEdges(datasetVersionId: number): Promise<Array<{ playerId: number; clubId: number; playerName?: string; clubName?: string }>> {
    const result = await pgPool.query<{ player_id: string; club_id: string; player_name: string; club_name: string }>(
      `SELECT pc.player_id, pc.club_id, p.canonical_name AS player_name, c.canonical_name AS club_name
       FROM player_clubs pc
       JOIN players p ON p.id = pc.player_id
       JOIN clubs c ON c.id = pc.club_id
       WHERE pc.dataset_version_id = $1`,
      [datasetVersionId],
    );

    return result.rows.map((row) => ({
      playerId: Number(row.player_id),
      clubId: Number(row.club_id),
      playerName: row.player_name,
      clubName: row.club_name,
    }));
  }

  async hasPlayerClubEdge(datasetVersionId: number, playerId: number, clubId: number): Promise<boolean> {
    const result = await pgPool.query(
      `SELECT 1
       FROM player_clubs
       WHERE dataset_version_id = $1
         AND player_id = $2
         AND club_id = $3
       LIMIT 1`,
      [datasetVersionId, playerId, clubId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async getPlayerName(playerId: number): Promise<string | null> {
    const result = await pgPool.query<{ canonical_name: string }>(
      `SELECT canonical_name FROM players WHERE id = $1`,
      [playerId],
    );

    return result.rows[0]?.canonical_name ?? null;
  }

  async getClubName(clubId: number): Promise<string | null> {
    const result = await pgPool.query<{ canonical_name: string }>(
      `SELECT canonical_name FROM clubs WHERE id = $1`,
      [clubId],
    );

    return result.rows[0]?.canonical_name ?? null;
  }
}
