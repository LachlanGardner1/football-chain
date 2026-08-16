// One-time reconciliation: recomputes every existing players/clubs row's normalized_name under
// the CURRENT normalizeName() and merges any collisions that causes.
//
// Why this exists: players/clubs INSERT ... ON CONFLICT (normalized_name) DO UPDATE only works
// when a freshly-computed key matches a row's ALREADY-STORED key - normalized_name is the
// conflict target itself, so it's never rewritten on an existing row just because the
// normalization function changed. The next import then inserts a fresh duplicate instead of
// updating the original row. That already happened once for real (see
// db/migrations/010_merge_normalization_duplicate_players_and_clubs.sql - 1,188 duplicate
// players, 108 duplicate clubs, and a correct chain submission failed because a puzzle's anchor
// and its actual transfer edge lived on two different duplicate rows). Migration 010's fix only
// covered the specific shape of mess it found (exactly-2-row groups, matched by canonical_name
// string equality, and only the FK tables that existed at the time). This script is a general
// tool: run it any time normalizeName() changes, before the next import runs.
//
// Not related to ordinary same-name-collision handling DURING an import - that's already
// handled by import-transfermarkt.ts's own per-batch dedup + ON CONFLICT DO UPDATE.
import { pathToFileURL } from "node:url";

import type { Pool, PoolClient } from "pg";
import pg from "pg";

import { normalizeName } from "../normalize-name";

const { Pool: PgPool } = pg;

const UNIQUE_VIOLATION = "23505";
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

export interface NameRow {
  id: number;
  canonicalName: string;
  createdAt: string;
}

export interface CollisionGroup {
  newKey: string;
  winnerId: number;
  loserIds: number[];
}

// Groups rows by their newly-computed key; returns only groups with 2+ rows. Winner = the
// most-recently-created row (created_at DESC), generalizing migration 010's exactly-2-row rule
// (where the newer row was always the one with real fame data already backfilled onto it) to
// N-way groups. Not guaranteed correct for every possible future collision cause - the caller
// always prints full per-group detail before committing so a human can sanity-check the choice.
export function findCollisionGroups(rows: NameRow[], computeKey: (canonicalName: string) => string): CollisionGroup[] {
  const byKey = new Map<string, NameRow[]>();
  for (const row of rows) {
    const key = computeKey(row.canonicalName);
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const groups: CollisionGroup[] = [];
  for (const [newKey, groupRows] of byKey) {
    if (groupRows.length < 2) continue;
    const sorted = [...groupRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    groups.push({
      newKey,
      winnerId: sorted[0].id,
      loserIds: sorted.slice(1).map((row) => row.id),
    });
  }
  return groups;
}

// Every row's target normalized_name after reconciliation - winners of a collision group use
// the group's newKey, every other (non-colliding) row uses its own recomputed key. Feeds the
// final bulk UPDATE; a row whose old and new keys already match still appears here as a no-op.
export function computeTargetNormalizedNames(rows: NameRow[], computeKey: (canonicalName: string) => string): Map<number, string> {
  const groups = findCollisionGroups(rows, computeKey);
  const loserIds = new Set(groups.flatMap((group) => group.loserIds));
  const keyByWinnerId = new Map(groups.map((group) => [group.winnerId, group.newKey]));

  const targets = new Map<number, string>();
  for (const row of rows) {
    if (loserIds.has(row.id)) continue;
    targets.set(row.id, keyByWinnerId.get(row.id) ?? computeKey(row.canonicalName));
  }
  return targets;
}

interface ForeignKeyRef {
  referencingTable: string;
  referencingColumn: string;
}

interface Conflict {
  table: string;
  column: string;
  loserId: number;
  winnerId: number;
  errorMessage: string;
}

// Discovers every FK column referencing <table>(id), dynamically via information_schema, so
// this stays correct as more FK-referencing tables are added later without needing a
// hand-maintained list (migration 010 only covered player_clubs, daily_puzzle_players, and
// anchor_club_hints - tables added since, like speed-round's player references, would have been
// silently missed by a hardcoded list).
async function discoverForeignKeys(client: PoolClient, referencedTable: string): Promise<ForeignKeyRef[]> {
  const result = await client.query<{ referencing_table: string; referencing_column: string }>(
    `SELECT tc.table_name AS referencing_table, kcu.column_name AS referencing_column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
       AND ccu.table_name = $1 AND ccu.column_name = 'id'`,
    [referencedTable],
  );

  return result.rows.map((row) => {
    if (!IDENTIFIER_PATTERN.test(row.referencing_table) || !IDENTIFIER_PATTERN.test(row.referencing_column)) {
      throw new Error(`Unexpected identifier from information_schema: ${row.referencing_table}.${row.referencing_column}`);
    }
    return { referencingTable: row.referencing_table, referencingColumn: row.referencing_column };
  });
}

// Reparents every loser's references to the winner, one FK table at a time, using a savepoint
// per attempt so a conflict on one table/loser doesn't abort the whole run - every conflict
// gets surfaced in one pass. A conflict here means the winner already has an equivalent row in
// that table (e.g. a composite-PK join table) - deliberately not hand-guessing a per-table
// "equivalent row" check to skip in advance (unsafe to generalize across tables with different
// shapes); just attempt the UPDATE and let the table's own constraints raise on true conflicts.
async function reparentForeignKeys(
  client: PoolClient,
  foreignKeys: ForeignKeyRef[],
  group: CollisionGroup,
  conflicts: Conflict[],
): Promise<Set<number>> {
  const losersWithConflicts = new Set<number>();

  for (const loserId of group.loserIds) {
    for (const fk of foreignKeys) {
      await client.query("SAVEPOINT reparent_attempt");
      try {
        await client.query(
          `UPDATE "${fk.referencingTable}" SET "${fk.referencingColumn}" = $1 WHERE "${fk.referencingColumn}" = $2`,
          [group.winnerId, loserId],
        );
        await client.query("RELEASE SAVEPOINT reparent_attempt");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT reparent_attempt");
        const pgError = error as { code?: string; message: string };
        if (pgError.code !== UNIQUE_VIOLATION) throw error;
        losersWithConflicts.add(loserId);
        conflicts.push({
          table: fk.referencingTable,
          column: fk.referencingColumn,
          loserId,
          winnerId: group.winnerId,
          errorMessage: pgError.message,
        });
      }
    }
  }

  return losersWithConflicts;
}

function printGroupAudit(table: string, group: CollisionGroup, rowsById: Map<number, NameRow>): void {
  console.log(`  [${table}] collision on normalized_name = "${group.newKey}":`);
  const winner = rowsById.get(group.winnerId)!;
  console.log(`    winner id=${winner.id} "${winner.canonicalName}" created_at=${winner.createdAt}`);
  for (const loserId of group.loserIds) {
    const loser = rowsById.get(loserId)!;
    console.log(`    loser  id=${loser.id} "${loser.canonicalName}" created_at=${loser.createdAt}`);
  }
}

async function reconcileTable(client: PoolClient, table: "players" | "clubs", dryRun: boolean): Promise<{ conflicts: Conflict[] }> {
  const rowsResult = await client.query<{ id: number; canonical_name: string; created_at: Date }>(
    `SELECT id, canonical_name, created_at FROM ${table}`,
  );
  const rows: NameRow[] = rowsResult.rows.map((row) => ({
    id: row.id,
    canonicalName: row.canonical_name,
    createdAt: row.created_at.toISOString(),
  }));
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  console.log(`\n[${table}] scanned ${rows.length} rows.`);

  const groups = findCollisionGroups(rows, normalizeName);
  console.log(`[${table}] found ${groups.length} collision group(s).`);
  for (const group of groups) printGroupAudit(table, group, rowsById);

  const foreignKeys = await discoverForeignKeys(client, table);
  console.log(`[${table}] discovered FK columns: ${foreignKeys.map((fk) => `${fk.referencingTable}.${fk.referencingColumn}`).join(", ") || "(none)"}`);

  const conflicts: Conflict[] = [];
  const survivingLoserIds = new Set<number>();
  // A winner whose group left ANY loser un-merged can't safely take the shared key either -
  // the surviving loser still occupies it, so updating the winner to that key would just
  // reproduce the exact collision this script exists to resolve. Skip the whole group's
  // normalized_name update in that case; it's already reflected in `conflicts` above, which
  // rolls back the entire transaction anyway (see rebuildNormalizedNames), but skipping here
  // too means a --dry-run's printed counts describe what would actually happen.
  const winnerIdsWithSurvivingLosers = new Set<number>();

  for (const group of groups) {
    const losersWithConflicts = await reparentForeignKeys(client, foreignKeys, group, conflicts);
    for (const loserId of group.loserIds) {
      if (losersWithConflicts.has(loserId)) {
        survivingLoserIds.add(loserId);
        winnerIdsWithSurvivingLosers.add(group.winnerId);
        continue;
      }
      await client.query(`DELETE FROM ${table} WHERE id = $1`, [loserId]);
    }
  }

  const targets = computeTargetNormalizedNames(rows, normalizeName);
  let updatedCount = 0;
  for (const [id, newKey] of targets) {
    if (survivingLoserIds.has(id) || winnerIdsWithSurvivingLosers.has(id)) continue;
    await client.query(`UPDATE ${table} SET normalized_name = $1 WHERE id = $2`, [newKey, id]);
    updatedCount++;
  }

  const deletedCount = groups.flatMap((g) => g.loserIds).length - survivingLoserIds.size;
  if (dryRun) {
    console.log(`[${table}] (dry-run) would delete ${deletedCount} row(s), update ${updatedCount} normalized_name value(s).`);
  } else {
    console.log(`[${table}] deleted ${deletedCount} row(s), updated ${updatedCount} normalized_name value(s).`);
  }

  return { conflicts };
}

export async function rebuildNormalizedNames(pool: Pool, dryRun: boolean): Promise<{ conflicts: Conflict[] }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const playersResult = await reconcileTable(client, "players", dryRun);
    const clubsResult = await reconcileTable(client, "clubs", dryRun);
    const conflicts = [...playersResult.conflicts, ...clubsResult.conflicts];

    if (dryRun) {
      await client.query("ROLLBACK");
      console.log(`\n[dry-run] Rolled back. ${conflicts.length} conflict(s) would need manual resolution:`);
      for (const conflict of conflicts) {
        console.log(`  ${conflict.table}.${conflict.column}: loser id=${conflict.loserId} -> winner id=${conflict.winnerId}: ${conflict.errorMessage}`);
      }
    } else if (conflicts.length > 0) {
      await client.query("ROLLBACK");
      console.log(`\nRolled back - ${conflicts.length} conflict(s) found:`);
      for (const conflict of conflicts) {
        console.log(`  ${conflict.table}.${conflict.column}: loser id=${conflict.loserId} -> winner id=${conflict.winnerId}: ${conflict.errorMessage}`);
      }
      console.log("\nResolve each conflict by hand, then re-run.");
    } else {
      await client.query("COMMIT");
      console.log("\nCommitted.");
    }

    return { conflicts };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runFromCli(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new PgPool({ connectionString: databaseUrl });
  try {
    const { conflicts } = await rebuildNormalizedNames(pool, dryRun);
    if (!dryRun && conflicts.length > 0) {
      process.exit(1);
    }
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
