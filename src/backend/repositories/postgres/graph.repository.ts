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

  async loadPlayerClubEdges(datasetVersionId: number): Promise<Array<{ playerId: number; clubId: number }>> {
    const result = await pgPool.query<{ player_id: string; club_id: string }>(
      `SELECT player_id, club_id
       FROM player_clubs
       WHERE dataset_version_id = $1`,
      [datasetVersionId],
    );

    return result.rows.map((row) => ({
      playerId: Number(row.player_id),
      clubId: Number(row.club_id),
    }));
  }
}
