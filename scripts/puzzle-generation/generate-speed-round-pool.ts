// Pre-generates a pool of 3-anchor "speed round" puzzles for the 1v1 real-time race mode.
// Generation (an exhaustive-search solver call per candidate anchor draw) is not safe to run
// inline in an HTTP request - see the daily-mode equivalent (rotate-puzzles.ts) for the same
// reasoning - so a match just claims an existing row from speed_round_puzzles at creation time.
// Run manually/periodically (`npm run speed-round:generate-pool [count]`), not per-match.
//
// Reuses the daily-mode generator's low-level building blocks (the solver itself, dataset/edge
// loading, random-without-replacement sampling) rather than its higher-level
// generateCandidateChain wrapper, because that wrapper's chain-length acceptability policy is
// hard-coded to daily mode's rules (reject trivially-short chains). Speed round wants the
// opposite bias - short, fast-to-solve chains are the whole point of this mode - so it needs
// its own acceptability check.

import { pathToFileURL } from "node:url";

import type { Pool, PoolClient } from "pg";
import pg from "pg";

import { loadActiveDatasetVersionId, loadPlayerClubEdges, pickRandomAnchors } from "./rotate-puzzles";
import { findShortestAnchorChain, type GraphEdge } from "./solver";

const { Pool: PgPool } = pg;

export const SPEED_ROUND_ANCHOR_COUNT = 3;
// Much higher than daily mode's ANCHOR_MIN_MARKET_VALUE_EUR (40M) - this mode has no hints and
// needs to be solvable fast by two people racing, so anchors should be near-universally
// recognizable. Data-checked directly against the live DB: 58 players clear this bar today, and
// (once joined against the league filter below) all 58 turn out to have played in a top-5
// league anyway, so the intersection is the full 58 - comfortably enough combinations
// (C(58,3) ~= 30,856) for variety.
export const SPEED_ROUND_MIN_MARKET_VALUE_EUR = 100_000_000;
// transfermarkt's own domestic_competition_id codes for the "top 5" European leagues,
// confirmed directly against the cached competitions.csv: GB1=Premier League, ES1=La Liga,
// FR1=Ligue 1, IT1=Serie A, L1=Bundesliga.
export const SPEED_ROUND_TOP_LEAGUE_CODES = ["GB1", "ES1", "FR1", "IT1", "L1"];
// Same screening-budget idea as daily mode's GENERATION_SCREENING_NODE_BUDGET: fail a hard
// candidate draw fast and move on to the next one, rather than exhaustively proving it's hard.
export const SPEED_ROUND_SCREENING_NODE_BUDGET = 20_000;
export const SPEED_ROUND_MAX_ATTEMPTS_PER_PUZZLE = 200;
// No lower bound (unlike daily mode's MIN_EXTRA_CHAIN_LENGTH) - a short, near-trivial chain is
// desirable here, not something to reject. Only an upper bound, so a race never turns into a
// slog even with the smaller, more-interconnected top-5-league anchor pool.
export const SPEED_ROUND_MAX_CHAIN_LENGTH = 9;

export function isAcceptableSpeedRoundChainLength(chainLength: number): boolean {
  return chainLength <= SPEED_ROUND_MAX_CHAIN_LENGTH;
}

export interface GeneratedSpeedRoundCandidate {
  anchorPlayerIds: number[];
  chainLength: number;
}

function anchorSetKey(anchorPlayerIds: number[]): string {
  return [...anchorPlayerIds].sort((a, b) => a - b).join(",");
}

export interface GenerateSpeedRoundCandidateOptions {
  candidatePlayerIds: number[];
  excludedAnchorSetKeys: Set<string>;
  edges: GraphEdge[];
  rng?: () => number;
  maxAttempts?: number;
}

// Mirrors generateCandidateChain's "fail fast, try another draw, fall back to whatever
// solvable chain was found if nothing hits the target length band" structure, but scoped to
// speed round's own acceptability rule and pool-level anchor-set dedupe (so the same 3-player
// combo doesn't fill the pool repeatedly).
export function generateSpeedRoundCandidate(
  options: GenerateSpeedRoundCandidateOptions,
): GeneratedSpeedRoundCandidate | null {
  const { candidatePlayerIds, excludedAnchorSetKeys, edges } = options;
  const rng = options.rng ?? Math.random;
  const maxAttempts = options.maxAttempts ?? SPEED_ROUND_MAX_ATTEMPTS_PER_PUZZLE;

  if (candidatePlayerIds.length < SPEED_ROUND_ANCHOR_COUNT) {
    return null;
  }

  let fallback: GeneratedSpeedRoundCandidate | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const anchorPlayerIds = pickRandomAnchors(candidatePlayerIds, SPEED_ROUND_ANCHOR_COUNT, rng);
    if (excludedAnchorSetKeys.has(anchorSetKey(anchorPlayerIds))) continue;

    const chain = findShortestAnchorChain(anchorPlayerIds, edges, {
      nodeBudgetPerOrdering: SPEED_ROUND_SCREENING_NODE_BUDGET,
    });
    if (!chain) continue;

    if (!fallback) {
      fallback = { anchorPlayerIds, chainLength: chain.length };
    }
    if (isAcceptableSpeedRoundChainLength(chain.length)) {
      return { anchorPlayerIds, chainLength: chain.length };
    }
  }

  return fallback;
}

// Anchor pool for this mode specifically - much stricter than daily mode's
// loadFamousCandidatePlayerIds (fame bar + top-5-league membership, not fame alone). The rest
// of a race's chain (non-anchor players/clubs) is still validated against the full graph,
// unrestricted - only the *named* anchors are constrained.
export async function loadTopLeagueFamousCandidatePlayerIds(
  client: PoolClient,
  datasetVersionId: number,
): Promise<number[]> {
  const result = await client.query<{ id: string }>(
    `SELECT DISTINCT p.id
     FROM players p
     JOIN player_clubs pc ON pc.player_id = p.id AND pc.dataset_version_id = $1
     JOIN clubs c ON c.id = pc.club_id
     WHERE p.peak_market_value_eur >= $2
       AND c.domestic_competition_id = ANY($3::text[])`,
    [datasetVersionId, SPEED_ROUND_MIN_MARKET_VALUE_EUR, SPEED_ROUND_TOP_LEAGUE_CODES],
  );
  return result.rows.map((row) => Number(row.id));
}

async function loadExistingAnchorSetKeys(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ player_ids: number[] }>(
    `SELECT array_agg(player_id ORDER BY player_id) AS player_ids
     FROM speed_round_puzzle_players
     GROUP BY speed_round_puzzle_id`,
  );
  return new Set(result.rows.map((row) => row.player_ids.join(",")));
}

async function insertSpeedRoundPuzzle(
  client: PoolClient,
  candidate: GeneratedSpeedRoundCandidate,
  datasetVersionId: number,
): Promise<void> {
  await client.query("BEGIN");
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO speed_round_puzzles (dataset_version_id) VALUES ($1) RETURNING id`,
      [datasetVersionId],
    );
    const puzzleId = Number(result.rows[0].id);

    for (const anchorId of candidate.anchorPlayerIds) {
      await client.query(
        `INSERT INTO speed_round_puzzle_players (speed_round_puzzle_id, player_id) VALUES ($1, $2)`,
        [puzzleId, anchorId],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export interface GenerateSpeedRoundPoolOptions {
  count?: number;
  rng?: () => number;
}

export interface GenerateSpeedRoundPoolResult {
  requested: number;
  generated: number;
  skipped: number;
}

export async function generateSpeedRoundPool(
  pool: Pool,
  options?: GenerateSpeedRoundPoolOptions,
): Promise<GenerateSpeedRoundPoolResult> {
  const count = options?.count ?? 20;
  const rng = options?.rng ?? Math.random;

  const client = await pool.connect();
  try {
    const datasetVersionId = await loadActiveDatasetVersionId(client);
    const edges = await loadPlayerClubEdges(client, datasetVersionId);
    const candidatePlayerIds = await loadTopLeagueFamousCandidatePlayerIds(client, datasetVersionId);
    const excludedAnchorSetKeys = await loadExistingAnchorSetKeys(client);

    let generated = 0;
    let skipped = 0;

    for (let i = 0; i < count; i += 1) {
      const candidate = generateSpeedRoundCandidate({
        candidatePlayerIds,
        excludedAnchorSetKeys,
        edges,
        rng,
      });

      if (!candidate) {
        console.warn("generate-speed-round-pool: could not generate a puzzle for this slot; skipping.");
        skipped += 1;
        continue;
      }

      await insertSpeedRoundPuzzle(client, candidate, datasetVersionId);
      excludedAnchorSetKeys.add(anchorSetKey(candidate.anchorPlayerIds));
      generated += 1;
    }

    return { requested: count, generated, skipped };
  } finally {
    client.release();
  }
}

async function runFromCli(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const countArg = process.argv[2];
  const count = countArg ? Number(countArg) : undefined;

  const pool = new PgPool({ connectionString: databaseUrl });
  try {
    const result = await generateSpeedRoundPool(pool, { count });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

// See scripts/migrate.ts for why this uses pathToFileURL rather than a hand-built
// `file://${...}` template (breaks on Windows' backslash-separated argv[1] paths).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runFromCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
