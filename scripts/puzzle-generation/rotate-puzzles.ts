// Daily puzzle rotation: (1) promotes today's already-generated puzzle from DRAFT to
// PUBLISHED, and (2) tops up a rolling buffer of future DRAFT puzzles so there's always
// up to `DEFAULT_BUFFER_DAYS` days of puzzles queued ahead of time.
//
// Generation always inserts as DRAFT, never PUBLISHED - every read path in
// daily-puzzle.repository.ts filters on status = 'PUBLISHED' with no date bound, so a
// puzzle sitting in DRAFT for a future date is invisible to players no matter what date
// they request. That's the entire spoiler guard; it only works if this file never inserts
// anything as PUBLISHED directly.
//
// Runnable both as a CLI script (see the entrypoint at the bottom, `npm run puzzles:rotate`)
// and from the ops Lambda's "rotate-puzzles" action (scripts/ops-lambda/handler.ts) - RDS is
// private, so the Lambda is the only thing that can reach it once deployed.

import { pathToFileURL } from "node:url";

import type { Pool, PoolClient } from "pg";
import pg from "pg";

import { findShortestAnchorChain, type GraphEdge, type GraphNode } from "./solver";

const { Pool: PgPool } = pg;

export const DEFAULT_BUFFER_DAYS = 7;
export const RECENCY_DEDUPE_DAYS = 60;
export const MAX_GENERATION_ATTEMPTS = 200;
// findShortestAnchorChain's default budget (300k node expansions per ordering) is tuned for
// exhaustively solving *one specific, already-chosen* anchor set correctly - not for
// screening hundreds of random candidate draws. On the full imported catalog, a meaningful
// fraction of random 3-5-anchor draws are "technically connected but slow to prove" (far
// apart, routed through high-degree hub clubs), and grinding each one out to the full
// default budget made a single day's generation take tens of seconds to minutes. Screening
// with a much smaller budget means a hard draw gives up almost instantly so the next random
// draw gets tried instead - since we're sampling hundreds of candidates anyway, "fail fast
// and try another" beats "exhaustively prove this one is hard."
export const GENERATION_SCREENING_NODE_BUDGET = 20_000;
// Directly-adjacent anchors (no detour through a non-anchor player) produce a chain of
// exactly 2*anchorCount - 1 nodes. Requiring at least this many more nodes guarantees at
// least one non-anchor player somewhere in the chain, so puzzles aren't trivially "every
// anchor shares a club with the next one" every day. Tune freely.
export const MIN_EXTRA_CHAIN_LENGTH = 2;
export const MAX_CHAIN_LENGTH = 13;
export const ANCHOR_COUNT_CHOICES = [3, 4, 5];
// Deliberately stricter than the import's own 8M/20-cap inclusion bar (which only decides
// whether a player is in the graph at all) - "graph-eligible" and "anchor-worthy" are
// different bars. Connecting players in the middle of a chain still come from the full
// graph; only the *named* anchors are restricted to this pool, since that's what actually
// determines whether a puzzle feels fair vs. obscure. Tune freely.
export const ANCHOR_MIN_MARKET_VALUE_EUR = 30_000_000;
export const ANCHOR_MIN_CAPS = 40;

export interface RotationResult {
  today: string;
  promotedToday: boolean;
  targetDates: string[];
  generatedDates: string[];
  skippedDates: string[];
}

export interface GeneratedCandidate {
  anchorPlayerIds: number[];
  chain: GraphNode[];
}

function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

// Pure date math: the N dates immediately after `todayIso`, in order. Exported so it can be
// unit-tested without a database.
export function datesForTopUp(todayIso: string, bufferDays: number = DEFAULT_BUFFER_DAYS): string[] {
  const base = parseIsoDate(todayIso);
  const dates: string[] = [];
  for (let offset = 1; offset <= bufferDays; offset += 1) {
    const next = new Date(base);
    next.setUTCDate(base.getUTCDate() + offset);
    dates.push(toIsoDate(next));
  }
  return dates;
}

export function dateDaysBefore(todayIso: string, days: number): string {
  const base = parseIsoDate(todayIso);
  base.setUTCDate(base.getUTCDate() - days);
  return toIsoDate(base);
}

// Rejects chains that are trivially easy (no detour through a non-anchor player) or
// unreasonably long (a frustrating number of guesses). Pure so it's directly unit-testable.
export function isAcceptableChainLength(anchorCount: number, chainLength: number): boolean {
  const minLength = 2 * anchorCount - 1 + MIN_EXTRA_CHAIN_LENGTH;
  return chainLength >= minLength && chainLength <= MAX_CHAIN_LENGTH;
}

export function chooseAnchorCount(rng: () => number = Math.random): number {
  return ANCHOR_COUNT_CHOICES[Math.floor(rng() * ANCHOR_COUNT_CHOICES.length)];
}

// Falls back to the full graph pool if the famous-restricted pool can't even cover the
// largest possible anchor count, rather than failing every date outright. Pure so it's
// directly unit-testable without a database.
export function selectAnchorCandidatePool(famousCandidatePlayerIds: number[], fullCandidatePlayerIds: number[]): number[] {
  const maxAnchorCount = Math.max(...ANCHOR_COUNT_CHOICES);
  return famousCandidatePlayerIds.length >= maxAnchorCount ? famousCandidatePlayerIds : fullCandidatePlayerIds;
}

// Random sample without replacement. Throws if the pool is too small - callers are
// expected to have already checked `candidateIds.length >= count`.
export function pickRandomAnchors(candidateIds: number[], count: number, rng: () => number = Math.random): number[] {
  if (candidateIds.length < count) {
    throw new Error(`Not enough candidate players (${candidateIds.length}) to pick ${count} anchors.`);
  }

  const pool = [...candidateIds];
  const picked: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(rng() * pool.length);
    picked.push(pool[index]);
    pool.splice(index, 1);
  }
  return picked;
}

export interface GenerateCandidateOptions {
  anchorCount: number;
  candidatePlayerIds: number[];
  excludedPlayerIds: Set<number>;
  edges: GraphEdge[];
  rng?: () => number;
  maxAttempts?: number;
}

// Repeatedly samples random anchor sets and asks the solver whether they connect into an
// acceptable-length chain, falling back to "just solvable" if nothing in-band turns up
// within the attempt budget - top-up should never stall a whole run because one day's
// random draw was unlucky.
export function generateCandidateChain(options: GenerateCandidateOptions): GeneratedCandidate | null {
  const { anchorCount, edges } = options;
  const rng = options.rng ?? Math.random;
  const maxAttempts = options.maxAttempts ?? MAX_GENERATION_ATTEMPTS;

  let pool = options.candidatePlayerIds.filter((id) => !options.excludedPlayerIds.has(id));
  if (pool.length < anchorCount) {
    // Recency-dedupe excluded too much of the pool - a repeat anchor within the window is
    // a much smaller downside than leaving a day's puzzle ungenerated.
    pool = options.candidatePlayerIds;
  }
  if (pool.length < anchorCount) {
    return null;
  }

  let fallback: GeneratedCandidate | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const anchorPlayerIds = pickRandomAnchors(pool, anchorCount, rng);
    const chain = findShortestAnchorChain(anchorPlayerIds, edges, {
      nodeBudgetPerOrdering: GENERATION_SCREENING_NODE_BUDGET,
    });
    if (!chain) continue;

    if (!fallback) {
      fallback = { anchorPlayerIds, chain };
    }
    if (isAcceptableChainLength(anchorCount, chain.length)) {
      return { anchorPlayerIds, chain };
    }
  }

  return fallback;
}

async function loadActiveDatasetVersionId(client: PoolClient): Promise<number> {
  const result = await client.query<{ id: number }>(
    `SELECT id FROM data_versions WHERE is_active = TRUE ORDER BY imported_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("No active dataset version found.");
  return row.id;
}

async function loadPlayerClubEdges(client: PoolClient, datasetVersionId: number): Promise<GraphEdge[]> {
  const result = await client.query<{ player_id: string; club_id: string }>(
    `SELECT player_id, club_id FROM player_clubs WHERE dataset_version_id = $1`,
    [datasetVersionId],
  );
  return result.rows.map((row) => ({ playerId: Number(row.player_id), clubId: Number(row.club_id) }));
}

// Restricted pool for anchor sampling specifically - see ANCHOR_MIN_MARKET_VALUE_EUR/
// ANCHOR_MIN_CAPS above for why this is a stricter bar than plain graph membership.
async function loadFamousCandidatePlayerIds(client: PoolClient, datasetVersionId: number): Promise<number[]> {
  const result = await client.query<{ id: string }>(
    `SELECT DISTINCT p.id
     FROM players p
     JOIN player_clubs pc ON pc.player_id = p.id AND pc.dataset_version_id = $1
     WHERE p.peak_market_value_eur >= $2 OR p.international_caps >= $3`,
    [datasetVersionId, ANCHOR_MIN_MARKET_VALUE_EUR, ANCHOR_MIN_CAPS],
  );
  return result.rows.map((row) => Number(row.id));
}

async function loadRecentAnchorPlayerIds(client: PoolClient, sinceDateIso: string): Promise<Set<number>> {
  const result = await client.query<{ player_id: string }>(
    `SELECT DISTINCT dpp.player_id
     FROM daily_puzzle_players dpp
     JOIN daily_puzzles p ON p.id = dpp.daily_puzzle_id
     WHERE p.puzzle_date >= $1`,
    [sinceDateIso],
  );
  return new Set(result.rows.map((row) => Number(row.player_id)));
}

async function promoteTodayPuzzle(client: PoolClient, todayIso: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE daily_puzzles
     SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW()
     WHERE puzzle_date = $1 AND status = 'DRAFT'
     RETURNING id`,
    [todayIso],
  );
  return (result.rowCount ?? 0) > 0;
}

async function loadExistingPuzzleDates(client: PoolClient, dates: string[]): Promise<Set<string>> {
  const result = await client.query<{ puzzle_date: string }>(
    `SELECT to_char(puzzle_date, 'YYYY-MM-DD') AS puzzle_date
     FROM daily_puzzles
     WHERE puzzle_date = ANY($1::date[])`,
    [dates],
  );
  return new Set(result.rows.map((row) => row.puzzle_date));
}

// Inserts one DRAFT puzzle + its anchor rows in a single transaction. Uses
// ON CONFLICT DO NOTHING on puzzle_date as a race guard (e.g. two rotation runs
// overlapping); returns false without touching daily_puzzle_players if another run won.
async function insertDraftPuzzle(
  client: PoolClient,
  dateIso: string,
  candidate: GeneratedCandidate,
  datasetVersionId: number,
): Promise<boolean> {
  await client.query("BEGIN");
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO daily_puzzles (puzzle_date, optimal_length, dataset_version_id, status)
       VALUES ($1, $2, $3, 'DRAFT')
       ON CONFLICT (puzzle_date) DO NOTHING
       RETURNING id`,
      [dateIso, candidate.chain.length, datasetVersionId],
    );

    const row = result.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return false;
    }

    const puzzleId = Number(row.id);
    for (const anchorId of candidate.anchorPlayerIds) {
      await client.query(
        `INSERT INTO daily_puzzle_players (daily_puzzle_id, player_id) VALUES ($1, $2)`,
        [puzzleId, anchorId],
      );
    }

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export interface RunDailyRotationOptions {
  bufferDays?: number;
  rng?: () => number;
}

export async function runDailyRotation(pool: Pool, options?: RunDailyRotationOptions): Promise<RotationResult> {
  const bufferDays = options?.bufferDays ?? DEFAULT_BUFFER_DAYS;
  const rng = options?.rng ?? Math.random;

  const client = await pool.connect();
  try {
    const todayResult = await client.query<{ today: string }>(
      `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`,
    );
    const today = todayResult.rows[0].today;

    const promotedToday = await promoteTodayPuzzle(client, today);

    const targetDates = datesForTopUp(today, bufferDays);
    const existingDates = await loadExistingPuzzleDates(client, targetDates);
    const missingDates = targetDates.filter((date) => !existingDates.has(date));

    const generatedDates: string[] = [];
    const skippedDates: string[] = [];

    if (missingDates.length > 0) {
      const datasetVersionId = await loadActiveDatasetVersionId(client);
      const edges = await loadPlayerClubEdges(client, datasetVersionId);
      const candidatePlayerIds = Array.from(new Set(edges.map((edge) => edge.playerId)));
      const excludedPlayerIds = await loadRecentAnchorPlayerIds(
        client,
        dateDaysBefore(today, RECENCY_DEDUPE_DAYS),
      );

      // Anchors are sampled from the famous-restricted pool so named players are
      // recognizable; `edges` (what the solver pathfinds over) stays the full graph, so
      // connecting players in the middle of the chain can still be anyone - that's
      // deliberate. Falls back to the full graph pool if the famous pool somehow can't even
      // cover the largest possible anchor count, rather than failing every date outright.
      const famousCandidatePlayerIds = await loadFamousCandidatePlayerIds(client, datasetVersionId);
      const anchorCandidatePlayerIds = selectAnchorCandidatePool(famousCandidatePlayerIds, candidatePlayerIds);

      for (const date of missingDates) {
        const anchorCount = chooseAnchorCount(rng);
        const candidate = generateCandidateChain({
          anchorCount,
          candidatePlayerIds: anchorCandidatePlayerIds,
          excludedPlayerIds,
          edges,
          rng,
        });

        if (!candidate) {
          console.warn(`rotate-puzzles: could not generate a puzzle for ${date}; will retry on the next run.`);
          skippedDates.push(date);
          continue;
        }

        const inserted = await insertDraftPuzzle(client, date, candidate, datasetVersionId);
        if (inserted) {
          generatedDates.push(date);
          for (const anchorId of candidate.anchorPlayerIds) excludedPlayerIds.add(anchorId);
        } else {
          skippedDates.push(date);
        }
      }
    }

    return { today, promotedToday, targetDates, generatedDates, skippedDates };
  } finally {
    client.release();
  }
}

async function runFromCli(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new PgPool({ connectionString: databaseUrl });
  try {
    const result = await runDailyRotation(pool);
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
