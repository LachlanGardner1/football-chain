import type { HintRepository, RevealedAnchorClubHint } from "../../domain/repositories";
import { pgPool } from "./db";

export class PgHintRepository implements HintRepository {
  async getRevealedAnchorClubHints(userId: string, puzzleId: number): Promise<RevealedAnchorClubHint[]> {
    const result = await pgPool.query<{ anchor_player_id: string; club_id: string; club_name: string }>(
      `SELECT ach.anchor_player_id, ach.club_id, c.canonical_name AS club_name
       FROM anchor_club_hints ach
       JOIN clubs c ON c.id = ach.club_id
       WHERE ach.user_id = $1::uuid AND ach.puzzle_id = $2`,
      [userId, puzzleId],
    );

    return result.rows.map((row) => ({
      anchorPlayerId: Number(row.anchor_player_id),
      clubId: Number(row.club_id),
      clubName: row.club_name,
    }));
  }

  // "Most time spent" = longest (end_year - start_year) span, treating an open-ended/current
  // spell (end_year IS NULL) as running through the current year. start_year is never null
  // in the imported data, so no further fallback is needed. Ties broken by club id for
  // determinism (repeat hint requests for the same player return the same club).
  async getMostTimeAtClub(playerId: number, datasetVersionId: number): Promise<{ clubId: number; clubName: string } | null> {
    const result = await pgPool.query<{ id: string; canonical_name: string }>(
      `SELECT c.id, c.canonical_name
       FROM player_clubs pc
       JOIN clubs c ON c.id = pc.club_id
       WHERE pc.player_id = $1 AND pc.dataset_version_id = $2
       ORDER BY (COALESCE(pc.end_year, EXTRACT(YEAR FROM CURRENT_DATE)::INT) - pc.start_year) DESC, c.id ASC
       LIMIT 1`,
      [playerId, datasetVersionId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return { clubId: Number(row.id), clubName: row.canonical_name };
  }

  async recordAnchorClubHint(params: {
    userId: string;
    puzzleId: number;
    anchorPlayerId: number;
    clubId: number;
  }): Promise<void> {
    await pgPool.query(
      `INSERT INTO anchor_club_hints (user_id, puzzle_id, anchor_player_id, club_id)
       VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (user_id, puzzle_id, anchor_player_id) DO NOTHING`,
      [params.userId, params.puzzleId, params.anchorPlayerId, params.clubId],
    );
  }

  async getHintsUsed(userId: string, puzzleId: number): Promise<number> {
    const result = await pgPool.query<{ hints_used: number }>(
      `SELECT hints_used FROM game_results WHERE user_id = $1::uuid AND puzzle_id = $2`,
      [userId, puzzleId],
    );
    return result.rows[0]?.hints_used ?? 0;
  }

  async incrementHintsUsed(userId: string, puzzleId: number): Promise<number> {
    const client = await pgPool.connect();

    try {
      await client.query("BEGIN");

      // Mirrors PgGameResultRepository.upsertAttempt's users-then-game_results upsert
      // pattern, since a hint can be requested before /api/complete ever runs.
      await client.query(
        `INSERT INTO users (id, username)
         VALUES ($1::uuid, $2)
         ON CONFLICT (id) DO NOTHING`,
        [userId, `user-${userId.slice(0, 8)}`],
      );

      const result = await client.query<{ hints_used: number }>(
        `INSERT INTO game_results (user_id, puzzle_id, attempts, hints_used, solved)
         VALUES ($1::uuid, $2, 0, 1, FALSE)
         ON CONFLICT (user_id, puzzle_id) DO UPDATE SET
           hints_used = game_results.hints_used + 1,
           updated_at = NOW()
         RETURNING hints_used`,
        [userId, puzzleId],
      );

      await client.query("COMMIT");
      return result.rows[0].hints_used;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
