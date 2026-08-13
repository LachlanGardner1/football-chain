import type { GameResultRepository } from "../../domain/repositories";
import type { PuzzleOutcomeDTO, UserStatsDTO } from "../../domain/types";
import { pgPool } from "./db";

export class PgGameResultRepository implements GameResultRepository {
  async upsertAttempt(params: {
    userId: string;
    puzzleId: number;
    outcome: "SOLVED" | "FAILED";
    chainLength?: number;
    score: number;
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

      // Ensure a row exists before checking its lock state, mirroring the hint repository's
      // ensure-row pattern - this can be the very first thing recorded for this (user, puzzle).
      await client.query(
        `INSERT INTO game_results (user_id, puzzle_id, attempts, solved, hints_used, next_step_hints_used, outcome_locked)
         VALUES ($1::uuid, $2, 0, FALSE, 0, 0, FALSE)
         ON CONFLICT (user_id, puzzle_id) DO NOTHING`,
        [params.userId, params.puzzleId],
      );

      const existing = await client.query<{ outcome_locked: boolean }>(
        `SELECT outcome_locked FROM game_results WHERE user_id = $1::uuid AND puzzle_id = $2 FOR UPDATE`,
        [params.userId, params.puzzleId],
      );
      const alreadyLocked = existing.rows[0]?.outcome_locked ?? false;

      if (alreadyLocked) {
        // The official result for this puzzle is already recorded - this attempt is practice
        // only. Tracked for curiosity, never touches solved/best_chain_length/streak.
        await client.query(
          `UPDATE game_results SET attempts = attempts + 1, updated_at = NOW()
           WHERE user_id = $1::uuid AND puzzle_id = $2`,
          [params.userId, params.puzzleId],
        );
      } else {
        const solved = params.outcome === "SOLVED";
        await client.query(
          `UPDATE game_results
           SET attempts = attempts + 1,
               solved = $3,
               solved_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
               failed_at = CASE WHEN $3 THEN NULL ELSE NOW() END,
               best_chain_length = COALESCE($4, best_chain_length),
               locked_score = $5,
               outcome_locked = TRUE,
               updated_at = NOW()
           WHERE user_id = $1::uuid AND puzzle_id = $2`,
          [params.userId, params.puzzleId, solved, params.chainLength ?? null, params.score],
        );

        // Either direction only affects the streak if this is actually today's puzzle -
        // solving (or failing) an older, backfilled puzzle should never move the streak,
        // matching how daily-puzzle games like Wordle handle archive play.
        if (solved) {
          await client.query(
            `SELECT refresh_user_streak($1::uuid, CURRENT_DATE)
             WHERE EXISTS (
               SELECT 1 FROM daily_puzzles WHERE id = $2 AND puzzle_date = CURRENT_DATE
             )`,
            [params.userId, params.puzzleId],
          );
        } else {
          // getUserStats' own staleness check would eventually show this streak as broken
          // once a full day passed with no solve, but that's a day too late for "you failed
          // today" to actually feel like it ruined the streak today - zero it immediately
          // instead. No-op if the user has no streak row yet (nothing to break).
          await client.query(
            `UPDATE user_streaks
             SET current_streak = 0, updated_at = NOW()
             WHERE user_id = $1::uuid
               AND EXISTS (
                 SELECT 1 FROM daily_puzzles WHERE id = $2 AND puzzle_date = CURRENT_DATE
               )`,
            [params.userId, params.puzzleId],
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getOutcome(userId: string, puzzleId: number): Promise<PuzzleOutcomeDTO> {
    const result = await pgPool.query<{
      outcome_locked: boolean;
      solved: boolean;
      failed_at: string | null;
      best_chain_length: number | null;
      locked_score: number | null;
    }>(
      `SELECT outcome_locked, solved, failed_at, best_chain_length, locked_score
       FROM game_results
       WHERE user_id = $1::uuid AND puzzle_id = $2`,
      [userId, puzzleId],
    );

    const row = result.rows[0];
    if (!row) {
      return { outcomeLocked: false, solved: false, failedAt: null, bestChainLength: null, lockedScore: null };
    }

    return {
      outcomeLocked: row.outcome_locked,
      solved: row.solved,
      failedAt: row.failed_at,
      bestChainLength: row.best_chain_length,
      lockedScore: row.locked_score,
    };
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
         -- A streak is only still "live" if its last on-time solve was today or
         -- yesterday; once a full day has been missed without playing, it reads as
         -- broken here even though the stored row isn't reset until the next solve.
         CASE
           WHEN us.last_solved_date IS NULL THEN 0
           WHEN us.last_solved_date >= CURRENT_DATE - INTERVAL '1 day' THEN us.current_streak
           ELSE 0
         END AS current_streak,
         us.max_streak
       FROM users u
       LEFT JOIN game_results gr ON gr.user_id = u.id
       LEFT JOIN user_streaks us ON us.user_id = u.id
       WHERE u.id = $1::uuid
       GROUP BY us.current_streak, us.max_streak, us.last_solved_date`,
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
