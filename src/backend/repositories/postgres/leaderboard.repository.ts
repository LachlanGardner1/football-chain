import type { LeaderboardRepository } from "../../domain/repositories";
import type { DailyLeaderboardDTO, DuelPlayerDetailDTO, DuelRankingEntryDTO } from "../../domain/types";
import { pgPool } from "./db";

export class PgLeaderboardRepository implements LeaderboardRepository {
  async getDailyLeaderboard(requestedDate: string | null, viewerUserId: string): Promise<DailyLeaderboardDTO> {
    const meta = await pgPool.query<{ resolved_date: string; is_today: boolean; viewer_unlocked: boolean }>(
      `SELECT
         to_char(COALESCE($1::date, (now() AT TIME ZONE 'Australia/Sydney')::date), 'YYYY-MM-DD') AS resolved_date,
         (COALESCE($1::date, (now() AT TIME ZONE 'Australia/Sydney')::date)
            = (now() AT TIME ZONE 'Australia/Sydney')::date) AS is_today,
         EXISTS (
           SELECT 1
           FROM game_results gr
           JOIN daily_puzzles dp ON dp.id = gr.puzzle_id
           WHERE dp.puzzle_date = COALESCE($1::date, (now() AT TIME ZONE 'Australia/Sydney')::date)
             AND gr.user_id = $2::uuid
             AND gr.outcome_locked = TRUE
         ) AS viewer_unlocked`,
      [requestedDate, viewerUserId],
    );

    const { resolved_date, is_today, viewer_unlocked } = meta.rows[0];
    const locked = is_today && !viewer_unlocked;

    if (locked) {
      return { date: resolved_date, isToday: true, locked: true, viewerUserId, entries: [] };
    }

    const entries = await pgPool.query<{
      user_id: string;
      display_name: string | null;
      solved: boolean;
      best_chain_length: number | null;
      locked_score: number;
    }>(
      `SELECT gr.user_id, u.display_name, gr.solved, gr.best_chain_length, gr.locked_score
       FROM game_results gr
       JOIN daily_puzzles dp ON dp.id = gr.puzzle_id
       JOIN users u ON u.id = gr.user_id
       WHERE dp.puzzle_date = $1::date
         AND gr.outcome_locked = TRUE
       ORDER BY gr.locked_score DESC, COALESCE(gr.solved_at, gr.failed_at) ASC`,
      [resolved_date],
    );

    return {
      date: resolved_date,
      isToday: is_today,
      locked: false,
      viewerUserId,
      entries: entries.rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        solved: row.solved,
        chainLength: row.best_chain_length,
        score: row.locked_score,
      })),
    };
  }

  async getDuelRankings(): Promise<DuelRankingEntryDTO[]> {
    const result = await pgPool.query<{
      user_id: string;
      display_name: string | null;
      wins: number;
      losses: number;
      rating: number;
    }>(
      `SELECT u.id AS user_id, u.display_name, udr.wins, udr.losses, udr.rating
       FROM user_duel_ratings udr
       JOIN users u ON u.id = udr.user_id
       ORDER BY udr.rating DESC, udr.wins DESC, u.id ASC`,
    );

    return result.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      wins: row.wins,
      losses: row.losses,
      rating: row.rating,
    }));
  }

  async getDuelPlayerDetail(userId: string): Promise<DuelPlayerDetailDTO | null> {
    const base = await pgPool.query<{
      user_id: string;
      display_name: string | null;
      wins: number;
      losses: number;
      rating: number;
    }>(
      `SELECT u.id AS user_id, u.display_name, udr.wins, udr.losses, udr.rating
       FROM user_duel_ratings udr
       JOIN users u ON u.id = udr.user_id
       WHERE u.id = $1::uuid`,
      [userId],
    );

    const row = base.rows[0];
    if (!row) return null;

    const matches = await pgPool.query<{
      match_id: string;
      winner_user_id: string | null;
      forfeited_slot: "a" | "b" | null;
      finished_at: string | null;
      opponent_user_id: string | null;
      opponent_display_name: string | null;
    }>(
      `SELECT
         srm.id AS match_id,
         srm.winner_user_id,
         srm.forfeited_slot,
         GREATEST(srm.player_a_finished_at, srm.player_b_finished_at) AS finished_at,
         CASE WHEN srm.player_a_user_id = $1::uuid THEN srm.player_b_user_id ELSE srm.player_a_user_id END AS opponent_user_id,
         ou.display_name AS opponent_display_name
       FROM speed_round_matches srm
       LEFT JOIN users ou
         ON ou.id = CASE WHEN srm.player_a_user_id = $1::uuid THEN srm.player_b_user_id ELSE srm.player_a_user_id END
       WHERE (srm.player_a_user_id = $1::uuid OR srm.player_b_user_id = $1::uuid)
         AND srm.status = 'FINISHED'
       ORDER BY srm.started_at DESC NULLS LAST
       LIMIT 10`,
      [userId],
    );

    return {
      userId: row.user_id,
      displayName: row.display_name,
      wins: row.wins,
      losses: row.losses,
      rating: row.rating,
      recentMatches: matches.rows.map((match) => ({
        matchId: Number(match.match_id),
        opponentUserId: match.opponent_user_id,
        opponentDisplayName: match.opponent_display_name,
        won: match.winner_user_id === userId,
        forfeited: match.forfeited_slot !== null,
        finishedAt: match.finished_at,
      })),
    };
  }
}
