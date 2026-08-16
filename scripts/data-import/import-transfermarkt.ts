import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { parse } from "csv-parse/sync";
import pg from "pg";

import { normalizeName } from "../normalize-name";

const { Pool } = pg;

// dcaribou/transfermarkt-datasets — CC0-1.0, refreshed weekly, no auth required.
// https://github.com/dcaribou/transfermarkt-datasets
const DATA_BASE_URL = "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data";
const CACHE_DIR = path.join(process.cwd(), "scripts/data-import/.cache");

const SOURCE_NAME = "transfermarkt-datasets";
// transfers.csv has zero rows for some real, well-known players (confirmed directly: Xabi
// Alonso, now a manager rather than an active player, has none at all) - most likely because
// this dataset prioritizes currently-rostered squads. player_valuations.csv covers a lot of
// that gap (confirmed 85.8% of the players left with zero transfers-derived edges have at
// least one valuation row, cross-checked against 6 real career histories including Xabi
// Alonso, Iniesta, Hazard, Bale, Rooney, Xavi - all correct). It now runs for every selected
// player, not just players transfers.csv left with zero edges - a player with SOME real
// transfer edges can still have a real gap (a missing stint), and restricting valuation edges
// to clubs not already covered by that player's real edges (see realCoveredClubKeysByPlayer
// below) keeps this additive rather than duplicative. Tagged with its own source_name so these
// edges stay identifiable/auditable later.
const VALUATION_FALLBACK_SOURCE_NAME = "transfermarkt-datasets-valuations";
const BATCH_SIZE = 500;

// Official transfermarkt names, not the old hand-seeded short names ("Ajax", "AS Roma",
// "Bayer Leverkusen") - this list only drives the post-import diagnostic printout below, but
// using the short names would make it look like the dead-end problem is still unfixed once
// those short-named rows are merged away (db/migrations/007_merge_duplicate_clubs.sql).
const KNOWN_DEAD_END_CLUBS = ["Borussia Dortmund", "Inter Milan", "Ajax Amsterdam", "Associazione Sportiva Roma", "Bayer 04 Leverkusen"];

// player_valuations.csv sentinel current_club_name values that aren't real clubs, and
// youth/reserve-team entries (confirmed patterns like "1.FC Köln U19",
// "1.FC Kaiserslautern II") that aren't meaningful "which club did they play for" answers for
// this game.
const NON_CLUB_VALUATION_NAMES = new Set(["Retired", "Without Club", "Unknown", "Career break"]);
const YOUTH_OR_RESERVE_TEAM_PATTERN = /\bu(1[4-9]|2[0-3])\b|\b(ii|iii)$/i;

interface PlayerRow {
  player_id: string;
  name: string;
  date_of_birth?: string;
  country_of_citizenship?: string;
  position?: string;
  international_caps?: string;
  highest_market_value_in_eur?: string;
}

interface ClubRow {
  club_id: string;
  name: string;
  domestic_competition_id?: string;
}

interface TransferRow {
  player_id: string;
  transfer_date: string;
  to_club_id: string;
}

interface CompetitionRow {
  competition_id: string;
  country_name?: string;
}

interface PlayerValuationRow {
  player_id: string;
  date: string;
  current_club_name?: string;
}

interface DerivedEdge {
  playerTmId: string;
  clubTmId: string;
  startYear: number | null;
  endYear: number | null;
}

// Same shape as DerivedEdge but resolved by club *name* rather than a transfermarkt club id -
// player_valuations.csv's own current_club_id column isn't trustworthy (confirmed directly:
// Xabi Alonso's Liverpool rows and his Real Madrid rows both show current_club_id=27, while
// current_club_name correctly varies), so this never carries a club id at all.
interface ValuationDerivedEdge {
  playerTmId: string;
  clubName: string;
  startYear: number;
  endYear: number | null;
}

interface ReferencedClub {
  name: string;
  country: string | null;
  tmId: string | null;
  domesticCompetitionId: string | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function downloadAndCacheCsv(table: string): Promise<string> {
  const cachePath = path.join(CACHE_DIR, `${table}.csv`);
  if (existsSync(cachePath)) {
    return readFileSync(cachePath, "utf-8");
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const url = `${DATA_BASE_URL}/${table}.csv.gz`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  const gzipped = Buffer.from(await response.arrayBuffer());
  const csv = gunzipSync(gzipped).toString("utf-8");
  writeFileSync(cachePath, csv, "utf-8");
  return csv;
}

function parseCsv<T>(csv: string): T[] {
  return parse(csv, { columns: true, skip_empty_lines: true, relax_column_count: true }) as T[];
}

function isRealClubValuationName(name: string | undefined): name is string {
  if (!name) return false;
  if (NON_CLUB_VALUATION_NAMES.has(name)) return false;
  if (YOUTH_OR_RESERVE_TEAM_PATTERN.test(name)) return false;
  return true;
}

// Collapses a player's chronologically-sorted valuation rows into one edge per run of
// consecutive rows sharing the same club - the same "the next entry's start becomes this
// one's end" approximation the primary transfers-derived path already uses, just applied to
// valuation snapshot dates instead of transfer dates.
function deriveValuationEdgesForPlayer(playerTmId: string, rows: PlayerValuationRow[]): ValuationDerivedEdge[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  const runs: Array<{ clubName: string; startDate: string }> = [];
  for (const row of sorted) {
    const clubName = row.current_club_name!;
    const currentRun = runs[runs.length - 1];
    if (currentRun && currentRun.clubName === clubName) continue;
    runs.push({ clubName, startDate: row.date });
  }

  return runs.map((run, index) => {
    const next = runs[index + 1];
    return {
      playerTmId,
      clubName: run.clubName,
      startYear: Number(run.startDate.slice(0, 4)),
      endYear: next ? Number(next.startDate.slice(0, 4)) : null,
    };
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  console.log("Downloading transfermarkt-datasets CSVs (cached under scripts/data-import/.cache/)...");
  const [playersCsv, clubsCsv, transfersCsv, competitionsCsv] = await Promise.all([
    downloadAndCacheCsv("players"),
    downloadAndCacheCsv("clubs"),
    downloadAndCacheCsv("transfers"),
    downloadAndCacheCsv("competitions"),
  ]);

  const allPlayers = parseCsv<PlayerRow>(playersCsv);
  const allClubs = parseCsv<ClubRow>(clubsCsv);
  const allTransfers = parseCsv<TransferRow>(transfersCsv);
  const allCompetitions = parseCsv<CompetitionRow>(competitionsCsv);

  const competitionCountry = new Map<string, string>();
  for (const competition of allCompetitions) {
    if (competition.country_name) {
      competitionCountry.set(competition.competition_id, competition.country_name);
    }
  }

  const clubByTmId = new Map<string, { name: string; country: string | null; domesticCompetitionId: string | null }>();
  for (const club of allClubs) {
    clubByTmId.set(club.club_id, {
      name: club.name,
      country: (club.domestic_competition_id && competitionCountry.get(club.domestic_competition_id)) || null,
      domesticCompetitionId: club.domestic_competition_id || null,
    });
  }

  // Only a data-quality floor, not a fame filter - the DB-wide catalog should include
  // essentially every player in the raw dataset, so search/chain-building isn't missing real
  // players. Which players are famous enough to be a puzzle *anchor* is decided separately and
  // much more strictly, at generation time, by ANCHOR_MIN_MARKET_VALUE_EUR in
  // scripts/puzzle-generation/rotate-puzzles.ts - not duplicated or loosened here.
  const selectedPlayers = allPlayers.filter((player) => player.name && player.name.trim().length > 0);
  const selectedPlayerById = new Map(selectedPlayers.map((player) => [player.player_id, player]));

  console.log(`Selected ${selectedPlayers.length} of ${allPlayers.length} players (non-empty name).`);

  const transfersByPlayer = new Map<string, TransferRow[]>();
  let skippedUnresolved = 0;
  for (const transfer of allTransfers) {
    if (!selectedPlayerById.has(transfer.player_id)) continue;
    if (!clubByTmId.has(transfer.to_club_id)) {
      // Sentinel non-club destinations (Retired / Without Club / Career break / Unknown)
      // have no matching row in clubs.csv, so this also naturally excludes them.
      skippedUnresolved++;
      continue;
    }
    const list = transfersByPlayer.get(transfer.player_id) ?? [];
    list.push(transfer);
    transfersByPlayer.set(transfer.player_id, list);
  }

  const derivedEdges: DerivedEdge[] = [];
  for (const transfers of transfersByPlayer.values()) {
    transfers.sort((a, b) => a.transfer_date.localeCompare(b.transfer_date));
    transfers.forEach((transfer, index) => {
      const startYear = transfer.transfer_date ? Number(transfer.transfer_date.slice(0, 4)) : null;
      const next = transfers[index + 1];
      const endYear = next?.transfer_date ? Number(next.transfer_date.slice(0, 4)) : null;
      derivedEdges.push({
        playerTmId: transfer.player_id,
        clubTmId: transfer.to_club_id,
        startYear,
        endYear,
      });
    });
  }

  // Per-player set of clubs already covered by a real transfers.csv-derived edge, keyed by
  // normalized club name (matching how valuation-derived edges resolve clubs - see
  // ValuationDerivedEdge's comment). Used below to keep the valuation pass additive (fills real
  // gaps in a player's history) rather than duplicative (re-describing a club the real data
  // already has, possibly with different start/end year boundaries that player_clubs's unique
  // constraint on (player_id, club_id, dataset_version_id, start_year, end_year) wouldn't catch
  // as an exact duplicate).
  const realCoveredClubKeysByPlayer = new Map<string, Set<string>>();
  for (const edge of derivedEdges) {
    const clubInfo = clubByTmId.get(edge.clubTmId);
    if (!clubInfo) continue;
    const set = realCoveredClubKeysByPlayer.get(edge.playerTmId) ?? new Set<string>();
    set.add(normalizeName(clubInfo.name));
    realCoveredClubKeysByPlayer.set(edge.playerTmId, set);
  }

  // Every selected player is a candidate for club-history supplementation from
  // player_valuations.csv, not just players transfers.csv left with zero edges (see
  // VALUATION_FALLBACK_SOURCE_NAME below) - a player with SOME real transfer edges can still
  // have real gaps (missing stints). realCoveredClubKeysByPlayer above keeps this additive for
  // players who already have full real coverage of a given club.
  const valuationFallbackPlayerIds = new Set(selectedPlayers.map((player) => player.player_id));

  let valuationDerivedEdges: ValuationDerivedEdge[] = [];
  if (valuationFallbackPlayerIds.size > 0) {
    const valuationsCsv = await downloadAndCacheCsv("player_valuations");
    const allValuations = parseCsv<PlayerValuationRow>(valuationsCsv);

    const valuationsByPlayer = new Map<string, PlayerValuationRow[]>();
    for (const row of allValuations) {
      if (!valuationFallbackPlayerIds.has(row.player_id)) continue;
      if (!isRealClubValuationName(row.current_club_name)) continue;
      const list = valuationsByPlayer.get(row.player_id) ?? [];
      list.push(row);
      valuationsByPlayer.set(row.player_id, list);
    }

    for (const [playerTmId, rows] of valuationsByPlayer) {
      const covered = realCoveredClubKeysByPlayer.get(playerTmId);
      const edges = deriveValuationEdgesForPlayer(playerTmId, rows);
      const supplemental = covered ? edges.filter((edge) => !covered.has(normalizeName(edge.clubName))) : edges;
      valuationDerivedEdges.push(...supplemental);
    }
  }

  const playersWithAnyEdge = new Set([
    ...derivedEdges.map((edge) => edge.playerTmId),
    ...valuationDerivedEdges.map((edge) => edge.playerTmId),
  ]);
  const zeroHistoryPlayerCount = selectedPlayers.length - playersWithAnyEdge.size;

  console.log(
    `Derived ${derivedEdges.length} player-club stints from transfers.csv ` +
      `(${skippedUnresolved} transfer rows skipped as unresolved destinations), plus ` +
      `${valuationDerivedEdges.length} supplemental stints from player_valuations.csv for ` +
      `${new Set(valuationDerivedEdges.map((edge) => edge.playerTmId)).size} players with a real gap ` +
      `(zero transfers-derived edges, or a club-history stint transfers.csv didn't cover) ` +
      `(${zeroHistoryPlayerCount} players still have no derivable history in either source).`,
  );

  // Merge both sources into one referenced-club list, resolved by normalized name throughout
  // rather than by transfermarkt club id - valuation-derived entries never had a trustworthy
  // id to begin with, and resolving everything the same way avoids needing two parallel
  // lookup paths.
  const referencedClubsByNormalizedName = new Map<string, ReferencedClub>();
  for (const edge of derivedEdges) {
    const info = clubByTmId.get(edge.clubTmId);
    if (!info) continue;
    const key = normalizeName(info.name);
    if (!referencedClubsByNormalizedName.has(key)) {
      referencedClubsByNormalizedName.set(key, {
        name: info.name,
        country: info.country,
        tmId: edge.clubTmId,
        domesticCompetitionId: info.domesticCompetitionId,
      });
    }
  }
  for (const edge of valuationDerivedEdges) {
    const key = normalizeName(edge.clubName);
    if (!referencedClubsByNormalizedName.has(key)) {
      referencedClubsByNormalizedName.set(key, { name: edge.clubName, country: null, tmId: null, domesticCompetitionId: null });
    }
  }
  const referencedClubs = Array.from(referencedClubsByNormalizedName.values());

  if (dryRun) {
    console.log(
      `[dry-run] Would upsert up to ${selectedPlayers.length} players, ${referencedClubs.length} clubs, ` +
        `${derivedEdges.length + valuationDerivedEdges.length} edges. Re-run without --dry-run to write to the database.`,
    );
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const versionResult = await client.query<{ id: string }>(
      `SELECT id FROM data_versions WHERE is_active = TRUE LIMIT 1`,
    );
    if (versionResult.rowCount === 0) {
      throw new Error(
        "No active data_versions row found. Run `npm run db:seed` first to establish a baseline dataset version.",
      );
    }
    const datasetVersionId = Number(versionResult.rows[0].id);

    // Players: batch-insert. peak_market_value_eur/international_caps use DO UPDATE (not DO
    // NOTHING like the rest of the row) so re-running the import backfills fame data onto
    // already-existing rows too - including the original hand-seeded players, which match an
    // import row by normalized name - not just newly-inserted ones. A single lookup query
    // then resolves every normalized name (new or pre-existing) to its id.
    for (const batch of chunk(selectedPlayers, BATCH_SIZE)) {
      // Two different transfermarkt player rows can normalize to the same name (genuine
      // same-name players, or two spellings that now fold together after normalizeName's
      // accent-stripping). Postgres allows that under ON CONFLICT DO NOTHING (all but the
      // first are silently skipped) but errors under DO UPDATE ("cannot affect row a second
      // time") if two rows in the *same* INSERT target the same conflict key. Deduping the
      // batch first-seen-wins is enough - any name dropped here still resolves to the same
      // players.id afterward via the normalized_name lookup below, since that's the row this
      // insert actually wrote.
      const seenNormalizedNames = new Set<string>();
      const dedupedBatch = batch.filter((player) => {
        const key = normalizeName(player.name);
        if (seenNormalizedNames.has(key)) return false;
        seenNormalizedNames.add(key);
        return true;
      });

      const values: unknown[] = [];
      const placeholders = dedupedBatch.map((player, index) => {
        const base = index * 8;
        values.push(
          player.name,
          normalizeName(player.name),
          player.date_of_birth ? player.date_of_birth.slice(0, 10) : null,
          player.country_of_citizenship || null,
          player.position || null,
          player.player_id,
          player.highest_market_value_in_eur ? Number(player.highest_market_value_in_eur) : null,
          player.international_caps ? Number(player.international_caps) : null,
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`;
      });

      await client.query(
        `INSERT INTO players (canonical_name, normalized_name, dob, country, position, source_entity_id, peak_market_value_eur, international_caps)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (normalized_name) DO UPDATE SET
           peak_market_value_eur = EXCLUDED.peak_market_value_eur,
           international_caps = EXCLUDED.international_caps`,
        values,
      );
    }

    const playerNormalizedNames = selectedPlayers.map((player) => normalizeName(player.name));
    const playerIdRows = await client.query<{ id: string; normalized_name: string }>(
      `SELECT id, normalized_name FROM players WHERE normalized_name = ANY($1::text[])`,
      [playerNormalizedNames],
    );
    const playerDbIdByNormalizedName = new Map(playerIdRows.rows.map((row) => [row.normalized_name, Number(row.id)]));
    const playerDbIdByTmId = new Map<string, number>();
    for (const player of selectedPlayers) {
      const dbId = playerDbIdByNormalizedName.get(normalizeName(player.name));
      if (dbId !== undefined) {
        playerDbIdByTmId.set(player.player_id, dbId);
      }
    }
    const playersInserted = playerDbIdByTmId.size;

    // Clubs: same batch-insert-then-lookup pattern, scoped to clubs actually referenced by a
    // derived edge from either source (so nothing enters the table without at least one
    // edge). domestic_competition_id uses DO UPDATE (not DO NOTHING like the rest of the row)
    // so re-running the import backfills league affiliation onto already-existing club rows
    // too - see db/migrations/014_club_competitions.sql and
    // scripts/puzzle-generation/generate-speed-round-pool.ts, which needs this to restrict
    // anchor selection to top-5-league clubs.
    for (const batch of chunk(referencedClubs, BATCH_SIZE)) {
      const values: unknown[] = [];
      const placeholders = batch.map((club, index) => {
        const base = index * 5;
        values.push(club.name, normalizeName(club.name), club.country, club.tmId, club.domesticCompetitionId);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`;
      });

      await client.query(
        `INSERT INTO clubs (canonical_name, normalized_name, country, source_entity_id, domestic_competition_id)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (normalized_name) DO UPDATE SET
           domestic_competition_id = EXCLUDED.domestic_competition_id`,
        values,
      );
    }

    const clubNormalizedNames = referencedClubs.map((club) => normalizeName(club.name));
    const clubIdRows = await client.query<{ id: string; normalized_name: string }>(
      `SELECT id, normalized_name FROM clubs WHERE normalized_name = ANY($1::text[])`,
      [clubNormalizedNames],
    );
    const clubDbIdByNormalizedName = new Map(clubIdRows.rows.map((row) => [row.normalized_name, Number(row.id)]));
    const clubsInserted = clubDbIdByNormalizedName.size;

    // Edges: resolve both sources through the same normalized-name club lookup, then insert
    // as one combined batch.
    const resolvedEdges: Array<{ playerDbId: number; clubDbId: number; startYear: number | null; endYear: number | null; sourceName: string }> = [];
    for (const edge of derivedEdges) {
      const playerDbId = playerDbIdByTmId.get(edge.playerTmId);
      const clubInfo = clubByTmId.get(edge.clubTmId);
      const clubDbId = clubInfo ? clubDbIdByNormalizedName.get(normalizeName(clubInfo.name)) : undefined;
      if (playerDbId === undefined || clubDbId === undefined) continue;
      resolvedEdges.push({ playerDbId, clubDbId, startYear: edge.startYear, endYear: edge.endYear, sourceName: SOURCE_NAME });
    }
    for (const edge of valuationDerivedEdges) {
      const playerDbId = playerDbIdByTmId.get(edge.playerTmId);
      const clubDbId = clubDbIdByNormalizedName.get(normalizeName(edge.clubName));
      if (playerDbId === undefined || clubDbId === undefined) continue;
      resolvedEdges.push({ playerDbId, clubDbId, startYear: edge.startYear, endYear: edge.endYear, sourceName: VALUATION_FALLBACK_SOURCE_NAME });
    }

    let edgesInserted = 0;
    for (const batch of chunk(resolvedEdges, BATCH_SIZE)) {
      const values: unknown[] = [];
      const placeholders: string[] = [];
      batch.forEach((edge, index) => {
        const base = index * 7;
        values.push(edge.playerDbId, edge.clubDbId, edge.startYear, edge.endYear, edge.sourceName, 1.0, datasetVersionId);
        placeholders.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
      });

      const result = await client.query(
        `INSERT INTO player_clubs (player_id, club_id, start_year, end_year, source_name, confidence, dataset_version_id)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (player_id, club_id, dataset_version_id, start_year, end_year) DO NOTHING`,
        values,
      );
      edgesInserted += result.rowCount ?? 0;
    }

    await client.query("COMMIT");

    console.log(`\nImport complete.`);
    console.log(`Players: ${playersInserted} resolved (new + pre-existing) of ${selectedPlayers.length} selected.`);
    console.log(`Clubs:   ${clubsInserted} resolved (new + pre-existing) of ${referencedClubs.length} referenced.`);
    console.log(`Edges:   ${edgesInserted} newly inserted of ${resolvedEdges.length} derived.`);

    console.log(`\nPreviously dead-end clubs:`);
    for (const name of KNOWN_DEAD_END_CLUBS) {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM player_clubs pc
         JOIN clubs c ON c.id = pc.club_id
         WHERE c.normalized_name = $1`,
        [normalizeName(name)],
      );
      console.log(`  ${name}: ${result.rows[0]?.count ?? 0} edge(s)`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
