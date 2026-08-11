import type { DailyPuzzleRepository } from "../../domain/repositories";
import type { DailyPuzzle, DailyPuzzleDTO } from "../../domain/types";
import { pgPool } from "./db";

export function mapPublishedPuzzleRowToDto(row: {
  puzzle_id: string;
  puzzle_date: string;
  optimal_length?: number | null;
  anchor_players?: Array<{ id: number | string; name: string }> | null;
}): DailyPuzzleDTO {
  console.info('[football-chain] daily puzzle mapped', {
    puzzleId: Number(row.puzzle_id),
    optimalLength: row.optimal_length ?? undefined,
  });

  return {
    puzzleId: Number(row.puzzle_id),
    date: row.puzzle_date,
    anchorPlayers: (row.anchor_players ?? []).map((player) => ({
      id: Number(player.id),
      name: player.name,
    })),
    optimalLength: row.optimal_length ?? undefined,
  };
}

export function getPublishedPuzzleLookupQueries(date: string) {
  return [
    {
      text: `SELECT
         p.id AS puzzle_id,
         to_char(p.puzzle_date, 'YYYY-MM-DD') AS puzzle_date,
         p.optimal_length,
         json_agg(json_build_object('id', pl.id, 'name', pl.canonical_name)) AS anchor_players
       FROM daily_puzzles p
       JOIN daily_puzzle_players dpp ON dpp.daily_puzzle_id = p.id
       JOIN players pl ON pl.id = dpp.player_id
       WHERE p.puzzle_date = $1
         AND p.status = 'PUBLISHED'
       GROUP BY p.id
       LIMIT 1`,
      values: [date],
    },
    {
      text: `SELECT
         p.id AS puzzle_id,
         to_char(p.puzzle_date, 'YYYY-MM-DD') AS puzzle_date,
         p.optimal_length,
         json_agg(json_build_object('id', pl.id, 'name', pl.canonical_name)) AS anchor_players
       FROM daily_puzzles p
       JOIN daily_puzzle_players dpp ON dpp.daily_puzzle_id = p.id
       JOIN players pl ON pl.id = dpp.player_id
       WHERE p.status = 'PUBLISHED'
       GROUP BY p.id
       ORDER BY p.puzzle_date DESC, p.id DESC
       LIMIT 1`,
      values: [],
    },
  ];
}

export class PgDailyPuzzleRepository implements DailyPuzzleRepository {
  async getPublishedPuzzleByDate(date: string, options?: { strict?: boolean }): Promise<DailyPuzzleDTO | null> {
    const rowQuery = getPublishedPuzzleLookupQueries(date);
    // Strict mode (an explicit date was requested, e.g. via the puzzle-date picker):
    // only the exact-date query runs - a date with no published puzzle returns null
    // rather than silently substituting the most recent one.
    const queriesToTry = options?.strict ? rowQuery.slice(0, 1) : rowQuery;

    for (const query of queriesToTry) {
      const result = await pgPool.query<{
        puzzle_id: string;
        puzzle_date: string;
        optimal_length: number | null;
        anchor_players: Array<{ id: number; name: string }> | null;
      }>(query.text, query.values);

      const row = result.rows[0];
      if (row) {
        return mapPublishedPuzzleRowToDto(row);
      }
    }

    return null;
  }

  async getPublishedDates(): Promise<{ dates: string[]; today: string }> {
    const [todayResult, datesResult] = await Promise.all([
      pgPool.query<{ today: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`),
      pgPool.query<{ puzzle_date: string }>(
        `SELECT to_char(puzzle_date, 'YYYY-MM-DD') AS puzzle_date
         FROM daily_puzzles
         WHERE status = 'PUBLISHED'
         ORDER BY puzzle_date`,
      ),
    ]);

    return {
      today: todayResult.rows[0].today,
      dates: datesResult.rows.map((row) => row.puzzle_date),
    };
  }

  async getPuzzleById(puzzleId: number): Promise<DailyPuzzle | null> {
    const result = await pgPool.query<{
      id: string;
      puzzle_date: string;
      optimal_length: number;
      dataset_version_id: string;
      status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
      anchor_player_ids: number[] | null;
    }>(
      `SELECT
         p.id,
         to_char(p.puzzle_date, 'YYYY-MM-DD') AS puzzle_date,
         p.optimal_length,
         p.dataset_version_id,
         p.status,
         array_agg(dpp.player_id) AS anchor_player_ids
       FROM daily_puzzles p
       LEFT JOIN daily_puzzle_players dpp ON dpp.daily_puzzle_id = p.id
       WHERE p.id = $1
       GROUP BY p.id
       LIMIT 1`,
      [puzzleId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: Number(row.id),
      puzzleDate: row.puzzle_date,
      anchorPlayerIds: (row.anchor_player_ids ?? []).map((id) => Number(id)),
      optimalLength: row.optimal_length,
      datasetVersionId: Number(row.dataset_version_id),
      status: row.status,
    };
  }
}
