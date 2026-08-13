// Dev-only utility: deletes today's puzzle (and any dependent game_results/anchor_club_hints
// rows) and immediately generates + publishes a fresh replacement.
//
// rotate-puzzles.ts's runDailyRotation deliberately never touches today - in the normal daily
// flow, today's puzzle already exists (generated as part of an earlier day's future-buffer
// fill) and only needs promoting. This script is for local iteration instead: rerolling a
// puzzle you're currently looking at without waiting for the calendar to move.

import type { PoolClient } from "pg";
import pg from "pg";

import {
  chooseAnchorCount,
  dateDaysBefore,
  generateCandidateChain,
  loadActiveDatasetVersionId,
  loadFamousCandidatePlayerIds,
  loadPlayerClubEdges,
  loadRecentAnchorPlayerIds,
  RECENCY_DEDUPE_DAYS,
  selectAnchorCandidatePool,
} from "./rotate-puzzles";

const { Pool } = pg;

async function deleteExistingPuzzle(client: PoolClient, todayIso: string): Promise<void> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM daily_puzzles WHERE puzzle_date = $1`,
    [todayIso],
  );
  const row = existing.rows[0];
  if (!row) return;

  const puzzleId = row.id;
  // daily_puzzle_players cascades automatically (ON DELETE CASCADE); game_results and
  // anchor_club_hints don't, so they're cleared explicitly first.
  await client.query(`DELETE FROM anchor_club_hints WHERE puzzle_id = $1`, [puzzleId]);
  await client.query(`DELETE FROM game_results WHERE puzzle_id = $1`, [puzzleId]);
  await client.query(`DELETE FROM daily_puzzles WHERE id = $1`, [puzzleId]);
  console.log(`Deleted puzzle ${puzzleId} (and its game_results/anchor_club_hints) for ${todayIso}.`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    const todayResult = await client.query<{ today: string }>(
      `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`,
    );
    const today = todayResult.rows[0].today;

    await deleteExistingPuzzle(client, today);

    const datasetVersionId = await loadActiveDatasetVersionId(client);
    const edges = await loadPlayerClubEdges(client, datasetVersionId);
    const candidatePlayerIds = Array.from(new Set(edges.map((edge) => edge.playerId)));
    const famousCandidatePlayerIds = await loadFamousCandidatePlayerIds(client, datasetVersionId);
    const anchorCandidatePlayerIds = selectAnchorCandidatePool(famousCandidatePlayerIds, candidatePlayerIds);
    const excludedPlayerIds = await loadRecentAnchorPlayerIds(client, dateDaysBefore(today, RECENCY_DEDUPE_DAYS));

    const anchorCount = chooseAnchorCount();
    const candidate = generateCandidateChain({
      anchorCount,
      candidatePlayerIds: anchorCandidatePlayerIds,
      excludedPlayerIds,
      edges,
    });

    if (!candidate) {
      throw new Error("Could not generate a candidate chain for today - try running this again.");
    }

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO daily_puzzles (puzzle_date, optimal_length, dataset_version_id, status, published_at)
       VALUES ($1, $2, $3, 'PUBLISHED', NOW())
       RETURNING id`,
      [today, candidate.chain.length, datasetVersionId],
    );
    const puzzleId = Number(insertResult.rows[0].id);

    for (const anchorId of candidate.anchorPlayerIds) {
      await client.query(
        `INSERT INTO daily_puzzle_players (daily_puzzle_id, player_id) VALUES ($1, $2)`,
        [puzzleId, anchorId],
      );
    }

    const anchorNames = await client.query<{ canonical_name: string }>(
      `SELECT canonical_name FROM players WHERE id = ANY($1::bigint[]) ORDER BY canonical_name`,
      [candidate.anchorPlayerIds],
    );

    console.log(
      `Generated puzzle ${puzzleId} for ${today}: ${anchorNames.rows.map((r) => r.canonical_name).join(", ")} ` +
        `(optimal length ${candidate.chain.length}).`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
