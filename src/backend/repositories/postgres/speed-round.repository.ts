import type { PoolClient } from "pg";

import type { SpeedRoundRepository } from "../../domain/repositories";
import type {
  ChainNodeInput,
  SpeedRoundCreateResultDTO,
  SpeedRoundJoinResult,
  SpeedRoundMatchStateDTO,
  SpeedRoundMatchStatus,
  SpeedRoundPlayerSlot,
} from "../../domain/types";
import { pgPool } from "./db";

// A finished-but-silent opponent (tab closed, connection dropped) shouldn't leave the other
// player stuck racing against no one forever - if their heartbeat (updated on every state
// poll, ~once/second while IN_PROGRESS) goes stale past this, the still-present player is
// declared the winner. Deliberately well above the ~1s poll interval so normal network jitter
// never triggers it.
const FORFEIT_TIMEOUT_SECONDS = 20;

const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I - read aloud/typed by hand
const INVITE_CODE_LENGTH = 6;

function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_CODE_ALPHABET[Math.floor(Math.random() * INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

interface MatchRow {
  id: string;
  invite_code: string;
  puzzle_id: string;
  status: SpeedRoundMatchStatus;
  started_at: string | null;
  player_a_user_id: string;
  player_b_user_id: string | null;
  player_a_ready_at: string | null;
  player_b_ready_at: string | null;
  player_a_last_seen_at: string | null;
  player_b_last_seen_at: string | null;
  player_a_finished_at: string | null;
  player_b_finished_at: string | null;
  player_a_chain: ChainNodeInput[] | null;
  player_b_chain: ChainNodeInput[] | null;
  winner_user_id: string | null;
  forfeited_slot: SpeedRoundPlayerSlot | null;
}

function resolveSlot(row: { player_a_user_id: string; player_b_user_id: string | null }, userId: string): SpeedRoundPlayerSlot | null {
  if (row.player_a_user_id === userId) return "a";
  if (row.player_b_user_id === userId) return "b";
  return null;
}

async function ensureUser(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `INSERT INTO users (id, username) VALUES ($1::uuid, $2) ON CONFLICT (id) DO NOTHING`,
    [userId, `user-${userId.slice(0, 8)}`],
  );
}

async function selectMatchRow(client: PoolClient, matchId: number): Promise<MatchRow | null> {
  const result = await client.query<MatchRow>(
    `SELECT id, invite_code, puzzle_id, status, started_at,
            player_a_user_id, player_b_user_id,
            player_a_ready_at, player_b_ready_at,
            player_a_last_seen_at, player_b_last_seen_at,
            player_a_finished_at, player_b_finished_at,
            player_a_chain, player_b_chain,
            winner_user_id, forfeited_slot
     FROM speed_round_matches
     WHERE id = $1`,
    [matchId],
  );
  return result.rows[0] ?? null;
}

// Runs whichever of the two fully-literal queries matches the caller's slot - never builds SQL
// by interpolating a column name, even though `slot` is always internally-derived (never raw
// user input) and would be "safe" to interpolate; this keeps every query in this file fully
// static, matching the rest of the codebase's convention.
async function execForSlot(
  client: PoolClient,
  slot: SpeedRoundPlayerSlot,
  sqlForA: string,
  sqlForB: string,
  params: unknown[],
): Promise<void> {
  await client.query(slot === "a" ? sqlForA : sqlForB, params);
}

export class PgSpeedRoundRepository implements SpeedRoundRepository {
  async createMatch(creatorUserId: string): Promise<SpeedRoundCreateResultDTO> {
    const client = await pgPool.connect();

    try {
      await client.query("BEGIN");
      await ensureUser(client, creatorUserId);

      // Least-used-first so the (currently small) pool rotates evenly across matches rather
      // than the first row always winning - see generate-speed-round-pool.ts for why puzzles
      // are pre-generated rather than created per-match.
      const puzzleResult = await client.query<{ id: string }>(
        `SELECT id FROM speed_round_puzzles ORDER BY used_count ASC, RANDOM() LIMIT 1`,
      );
      const puzzleRow = puzzleResult.rows[0];
      if (!puzzleRow) {
        throw new Error("No speed round puzzles available - run `npm run speed-round:generate-pool` first.");
      }
      const puzzleId = Number(puzzleRow.id);

      let matchId: number | null = null;
      let inviteCode = "";
      for (let attempt = 0; attempt < 5 && matchId === null; attempt += 1) {
        inviteCode = generateInviteCode();
        const insertResult = await client.query<{ id: string }>(
          `INSERT INTO speed_round_matches (invite_code, puzzle_id, player_a_user_id)
           VALUES ($1, $2, $3::uuid)
           ON CONFLICT (invite_code) DO NOTHING
           RETURNING id`,
          [inviteCode, puzzleId, creatorUserId],
        );
        if (insertResult.rows[0]) {
          matchId = Number(insertResult.rows[0].id);
        }
      }
      if (matchId === null) {
        throw new Error("Could not generate a unique speed round invite code.");
      }

      await client.query(`UPDATE speed_round_puzzles SET used_count = used_count + 1 WHERE id = $1`, [puzzleId]);

      await client.query("COMMIT");
      return { matchId, inviteCode };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async joinMatch(inviteCode: string, joinerUserId: string): Promise<SpeedRoundJoinResult> {
    const client = await pgPool.connect();

    try {
      await client.query("BEGIN");
      await ensureUser(client, joinerUserId);

      const existing = await client.query<{ id: string; player_a_user_id: string; player_b_user_id: string | null }>(
        `SELECT id, player_a_user_id, player_b_user_id FROM speed_round_matches WHERE invite_code = $1 FOR UPDATE`,
        [inviteCode.toUpperCase()],
      );
      const row = existing.rows[0];

      if (!row) {
        await client.query("ROLLBACK");
        return { kind: "NOT_FOUND" };
      }
      if (row.player_a_user_id === joinerUserId || row.player_b_user_id === joinerUserId) {
        // Already a participant (the creator's own page load resolves their invite code
        // through this same call, and a real second player re-navigating to the same link
        // hits this too) - idempotent success either way, not an error.
        await client.query("COMMIT");
        return { kind: "JOINED", matchId: Number(row.id) };
      }
      if (row.player_b_user_id !== null) {
        await client.query("ROLLBACK");
        return { kind: "FULL" };
      }

      await client.query(
        `UPDATE speed_round_matches
         SET player_b_user_id = $2::uuid, status = 'READY_COUNTDOWN', updated_at = NOW()
         WHERE id = $1`,
        [row.id, joinerUserId],
      );

      await client.query("COMMIT");
      return { kind: "JOINED", matchId: Number(row.id) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markReady(matchId: number, userId: string): Promise<void> {
    const client = await pgPool.connect();

    try {
      await client.query("BEGIN");

      const row = await selectMatchRow(client, matchId);
      if (!row) {
        await client.query("ROLLBACK");
        return;
      }

      const slot = resolveSlot(row, userId);
      if (!slot) {
        await client.query("ROLLBACK");
        return;
      }

      await execForSlot(
        client,
        slot,
        `UPDATE speed_round_matches SET player_a_ready_at = COALESCE(player_a_ready_at, NOW()), updated_at = NOW() WHERE id = $1`,
        `UPDATE speed_round_matches SET player_b_ready_at = COALESCE(player_b_ready_at, NOW()), updated_at = NOW() WHERE id = $1`,
        [matchId],
      );

      // Once both are ready, the countdown starts - a fixed 5s out from right now.
      await client.query(
        `UPDATE speed_round_matches
         SET started_at = NOW() + INTERVAL '5 seconds', updated_at = NOW()
         WHERE id = $1 AND started_at IS NULL AND player_a_ready_at IS NOT NULL AND player_b_ready_at IS NOT NULL`,
        [matchId],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getMatchState(matchId: number, userId: string): Promise<SpeedRoundMatchStateDTO> {
    const client = await pgPool.connect();

    try {
      await client.query("BEGIN");

      // Self-heal: the countdown having elapsed is a fact of wall-clock time, not something
      // any single request "does" - whichever player happens to poll after started_at has
      // passed is the one that flips this.
      await client.query(
        `UPDATE speed_round_matches
         SET status = 'IN_PROGRESS', updated_at = NOW()
         WHERE id = $1 AND status = 'READY_COUNTDOWN' AND started_at IS NOT NULL AND started_at <= NOW()`,
        [matchId],
      );

      const initialRow = await selectMatchRow(client, matchId);
      if (!initialRow) {
        throw new Error(`Speed round match ${matchId} not found.`);
      }

      const slot = resolveSlot(initialRow, userId);
      if (!slot) {
        throw new Error(`User ${userId} is not a participant in speed round match ${matchId}.`);
      }

      // Heartbeat - proves the caller is still here, which is exactly what the forfeit check
      // right below relies on for the *opponent's* side.
      await execForSlot(
        client,
        slot,
        `UPDATE speed_round_matches SET player_a_last_seen_at = NOW(), updated_at = NOW() WHERE id = $1`,
        `UPDATE speed_round_matches SET player_b_last_seen_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [matchId],
      );

      // Forfeit: if the match is still IN_PROGRESS, the opponent hasn't finished, and their
      // heartbeat is stale, the caller (who just proved presence above) wins by default.
      // COALESCE(..., started_at) matters here - an opponent who hasn't polled /state even
      // once yet (e.g. their page crashed the instant the race started, right after readying
      // up) has a NULL last_seen_at, and that must still get the same grace period measured
      // from when the race actually started, not be treated as *immediately* stale.
      const callerUserId = slot === "a" ? initialRow.player_a_user_id : initialRow.player_b_user_id;
      await execForSlot(
        client,
        slot,
        `UPDATE speed_round_matches
         SET status = 'FINISHED', winner_user_id = COALESCE(winner_user_id, $2::uuid),
             forfeited_slot = COALESCE(forfeited_slot, 'b'), updated_at = NOW()
         WHERE id = $1 AND status = 'IN_PROGRESS' AND player_b_finished_at IS NULL
           AND COALESCE(player_b_last_seen_at, started_at) < NOW() - INTERVAL '${FORFEIT_TIMEOUT_SECONDS} seconds'`,
        `UPDATE speed_round_matches
         SET status = 'FINISHED', winner_user_id = COALESCE(winner_user_id, $2::uuid),
             forfeited_slot = COALESCE(forfeited_slot, 'a'), updated_at = NOW()
         WHERE id = $1 AND status = 'IN_PROGRESS' AND player_a_finished_at IS NULL
           AND COALESCE(player_a_last_seen_at, started_at) < NOW() - INTERVAL '${FORFEIT_TIMEOUT_SECONDS} seconds'`,
        [matchId, callerUserId],
      );

      const finalRow = await selectMatchRow(client, matchId);
      if (!finalRow) {
        throw new Error(`Speed round match ${matchId} not found.`);
      }

      const anchorPlayers = await this.loadAnchorPlayers(client, Number(finalRow.puzzle_id));

      await client.query("COMMIT");
      return toStateDTO(finalRow, slot, anchorPlayers);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordFinish(params: { matchId: number; userId: string; chain: ChainNodeInput[] }): Promise<void> {
    const { matchId, userId, chain } = params;
    const client = await pgPool.connect();

    try {
      await client.query("BEGIN");

      const row = await selectMatchRow(client, matchId);
      if (!row) {
        await client.query("ROLLBACK");
        return;
      }

      const slot = resolveSlot(row, userId);
      if (!slot) {
        await client.query("ROLLBACK");
        return;
      }

      const chainJson = JSON.stringify(chain);

      // First-write-wins per slot (a second finish call from the same slot is a no-op via the
      // WHERE guard) - and, via COALESCE, the *first* slot to finish overall sets the match
      // winner. A losing player calling this afterward still records their own chain/time for
      // the summary screen without disturbing who won.
      await execForSlot(
        client,
        slot,
        `UPDATE speed_round_matches
         SET player_a_finished_at = NOW(),
             player_a_chain = $2::jsonb,
             status = CASE WHEN status = 'IN_PROGRESS' THEN 'FINISHED' ELSE status END,
             winner_user_id = COALESCE(winner_user_id, $3::uuid),
             updated_at = NOW()
         WHERE id = $1 AND player_a_finished_at IS NULL`,
        `UPDATE speed_round_matches
         SET player_b_finished_at = NOW(),
             player_b_chain = $2::jsonb,
             status = CASE WHEN status = 'IN_PROGRESS' THEN 'FINISHED' ELSE status END,
             winner_user_id = COALESCE(winner_user_id, $3::uuid),
             updated_at = NOW()
         WHERE id = $1 AND player_b_finished_at IS NULL`,
        [matchId, chainJson, userId],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadAnchorPlayers(client: PoolClient, puzzleId: number): Promise<Array<{ id: number; name: string }>> {
    const result = await client.query<{ id: string; canonical_name: string }>(
      `SELECT pl.id, pl.canonical_name
       FROM speed_round_puzzle_players srpp
       JOIN players pl ON pl.id = srpp.player_id
       WHERE srpp.speed_round_puzzle_id = $1
       ORDER BY pl.canonical_name`,
      [puzzleId],
    );
    return result.rows.map((row) => ({ id: Number(row.id), name: row.canonical_name }));
  }
}

function toStateDTO(row: MatchRow, slot: SpeedRoundPlayerSlot, anchorPlayers: Array<{ id: number; name: string }>): SpeedRoundMatchStateDTO {
  const you = slot === "a"
    ? {
        userId: row.player_a_user_id,
        readyAt: row.player_a_ready_at,
        finishedAt: row.player_a_finished_at,
        chain: row.player_a_chain,
      }
    : {
        userId: row.player_b_user_id,
        readyAt: row.player_b_ready_at,
        finishedAt: row.player_b_finished_at,
        chain: row.player_b_chain,
      };

  const opponent = slot === "a"
    ? {
        userId: row.player_b_user_id,
        readyAt: row.player_b_ready_at,
        finishedAt: row.player_b_finished_at,
        chain: row.player_b_chain,
      }
    : {
        userId: row.player_a_user_id,
        readyAt: row.player_a_ready_at,
        finishedAt: row.player_a_finished_at,
        chain: row.player_a_chain,
      };

  const winner: "you" | "opponent" | null =
    row.winner_user_id === null ? null : row.winner_user_id === you.userId ? "you" : "opponent";
  const opponentSlot: SpeedRoundPlayerSlot = slot === "a" ? "b" : "a";
  // Reads the explicit forfeited_slot column rather than inferring from "opponent hasn't
  // finished yet" - that would also be true for a perfectly normal race where the loser is
  // still actively playing and simply hasn't finished, which isn't a forfeit at all (they're
  // allowed to keep submitting afterward to record their own time for the summary screen).
  const opponentForfeited = row.forfeited_slot === opponentSlot;

  return {
    matchId: Number(row.id),
    inviteCode: row.invite_code,
    status: row.status,
    anchorPlayers,
    startedAt: row.started_at,
    you: slot,
    opponentPresent: opponent.userId !== null,
    youReady: you.readyAt !== null,
    opponentReady: opponent.readyAt !== null,
    youFinishedAt: you.finishedAt,
    opponentFinishedAt: opponent.finishedAt,
    youChain: you.chain,
    opponentChain: opponent.chain,
    winner,
    opponentForfeited,
  };
}
