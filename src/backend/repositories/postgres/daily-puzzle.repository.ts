import type { DailyPuzzleRepository } from "../../domain/repositories";
import type { DailyPuzzle, DailyPuzzleDTO } from "../../domain/types";
import { pgPool } from "./db";

export class PgDailyPuzzleRepository implements DailyPuzzleRepository {
  async getPublishedPuzzleByDate(date: string): Promise<DailyPuzzleDTO | null> {
    const result = await pgPool.query<{
      puzzle_id: string;
      puzzle_date: string;
      start_player_id: string;
      start_player_name: string;
      target_player_id: string;
      target_player_name: string;
    }>(
      `SELECT
         p.id AS puzzle_id,
         p.puzzle_date,
         p.start_player_id,
         sp.canonical_name AS start_player_name,
         p.target_player_id,
         tp.canonical_name AS target_player_name
       FROM daily_puzzles p
       JOIN players sp ON sp.id = p.start_player_id
       JOIN players tp ON tp.id = p.target_player_id
       WHERE p.puzzle_date = $1
         AND p.status = 'PUBLISHED'
       LIMIT 1`,
      [date],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      puzzleId: Number(row.puzzle_id),
      date: row.puzzle_date,
      startPlayer: {
        id: Number(row.start_player_id),
        name: row.start_player_name,
      },
      targetPlayer: {
        id: Number(row.target_player_id),
        name: row.target_player_name,
      },
    };
  }

  async getPuzzleById(puzzleId: number): Promise<DailyPuzzle | null> {
    const result = await pgPool.query<{
      id: string;
      puzzle_date: string;
      start_player_id: string;
      target_player_id: string;
      optimal_length: number;
      dataset_version_id: string;
      status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    }>(
      `SELECT
         id,
         puzzle_date,
         start_player_id,
         target_player_id,
         optimal_length,
         dataset_version_id,
         status
       FROM daily_puzzles
       WHERE id = $1
       LIMIT 1`,
      [puzzleId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: Number(row.id),
      puzzleDate: row.puzzle_date,
      startPlayerId: Number(row.start_player_id),
      targetPlayerId: Number(row.target_player_id),
      optimalLength: row.optimal_length,
      datasetVersionId: Number(row.dataset_version_id),
      status: row.status,
    };
  }
}
