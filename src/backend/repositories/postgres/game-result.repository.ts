import type { GameResultRepository } from "../../domain/repositories";
import type { UserStatsDTO } from "../../domain/types";
import { pgPool } from "./db";

export class PgGameResultRepository implements GameResultRepository {
  async upsertAttempt(params: {
    userId: string;
    puzzleId: number;
    solved: boolean;
    chainLength?: number;
  }): Promise<void> {
    const client = await pgPool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO users (id, username)
         VALUES ($1::uuid, $2)
         ON CONFLICT (id) DO NOTHING`,
        [params.userId, `user-${params.userId.slice(0, 8)}`],
      );

      await client.query(
        `INSERT INTO game_results (
           user_id,
           puzzle_id,
           attempts,
           best_chain_length,
           solved,
           hints_used,
           solved_at
         )
         VALUES (
           $1::uuid,
           $2,
           1,
           $3,
           $4,
           0,
           CASE WHEN $4 THEN NOW() ELSE NULL END
         )
         ON CONFLICT (user_id, puzzle_id)
         DO UPDATE SET
           attempts = game_results.attempts + 1,
           solved = game_results.solved OR EXCLUDED.solved,
           solved_at = CASE
             WHEN (game_results.solved = FALSE AND EXCLUDED.solved = TRUE) THEN NOW()
             ELSE game_results.solved_at
           END,
           best_chain_length = CASE
             WHEN EXCLUDED.best_chain_length IS NULL THEN game_results.best_chain_length
             WHEN game_results.best_chain_length IS NULL THEN EXCLUDED.best_chain_length
             ELSE LEAST(game_results.best_chain_length, EXCLUDED.best_chain_length)
           END,
           updated_at = NOW()`,
        [params.userId, params.puzzleId, params.chainLength ?? null, params.solved],
      );

      if (params.solved) {
        await client.query(
          `SELECT refresh_user_streak($1::uuid, CURRENT_DATE)`,
          [params.userId],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserStats(userId: string): Promise<UserStatsDTO> {
    const result = await pgPool.query<{
      solved_count: string;
      best_chain_length: number | null;
      current_streak: number | null;
      max_streak: number | null;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE gr.solved = TRUE) AS solved_count,
         MIN(gr.best_chain_length) FILTER (WHERE gr.best_chain_length IS NOT NULL) AS best_chain_length,
         us.current_streak,
         us.max_streak
       FROM users u
       LEFT JOIN game_results gr ON gr.user_id = u.id
       LEFT JOIN user_streaks us ON us.user_id = u.id
       WHERE u.id = $1::uuid
       GROUP BY us.current_streak, us.max_streak`,
      [userId],
    );

    const row = result.rows[0];

    if (!row) {
      return {
        solvedCount: 0,
        currentStreak: 0,
        maxStreak: 0,
        bestChainLength: null,
      };
    }

    return {
      solvedCount: Number(row.solved_count),
      currentStreak: Number(row.current_streak ?? 0),
      maxStreak: Number(row.max_streak ?? 0),
      bestChainLength: row.best_chain_length,
    };
  }
}
