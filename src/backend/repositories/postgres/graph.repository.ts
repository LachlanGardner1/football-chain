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

  // Only production caller is PgGraphService.buildAdjacency(), which builds a player<->club
  // adjacency map from playerId/clubId alone - no name columns needed, so this skips the
  // players/clubs joins that PgGraphService's own name-lookup path (getPlayerName/getClubName)
  // already handles separately when a name is actually needed.
  async loadPlayerClubEdges(datasetVersionId: number): Promise<Array<{ playerId: number; clubId: number; playerName?: string; clubName?: string }>> {
    const result = await pgPool.query<{ player_id: string; club_id: string }>(
      `SELECT pc.player_id, pc.club_id
       FROM player_clubs pc
       WHERE pc.dataset_version_id = $1`,
      [datasetVersionId],
    );

    return result.rows.map((row) => ({
      playerId: Number(row.player_id),
      clubId: Number(row.club_id),
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
