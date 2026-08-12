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

// A player qualifies if either threshold is met - market value alone undersells
// older/retired legends and goalkeepers, so international caps catches those too.
const MIN_HIGHEST_MARKET_VALUE_EUR = 8_000_000;
const MIN_INTERNATIONAL_CAPS = 20;

const SOURCE_NAME = "transfermarkt-datasets";
const BATCH_SIZE = 500;

// Official transfermarkt names, not the old hand-seeded short names ("Ajax", "AS Roma",
// "Bayer Leverkusen") - this list only drives the post-import diagnostic printout below, but
// using the short names would make it look like the dead-end problem is still unfixed once
// those short-named rows are merged away (db/migrations/007_merge_duplicate_clubs.sql).
const KNOWN_DEAD_END_CLUBS = ["Borussia Dortmund", "Inter Milan", "Ajax Amsterdam", "Associazione Sportiva Roma", "Bayer 04 Leverkusen"];

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

interface DerivedEdge {
  playerTmId: string;
  clubTmId: string;
  startYear: number | null;
  endYear: number | null;
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

  const clubByTmId = new Map<string, { name: string; country: string | null }>();
  for (const club of allClubs) {
    clubByTmId.set(club.club_id, {
      name: club.name,
      country: (club.domestic_competition_id && competitionCountry.get(club.domestic_competition_id)) || null,
    });
  }

  const selectedPlayers = allPlayers.filter((player) => {
    const value = Number(player.highest_market_value_in_eur || 0);
    const caps = Number(player.international_caps || 0);
    return value >= MIN_HIGHEST_MARKET_VALUE_EUR || caps >= MIN_INTERNATIONAL_CAPS;
  });
  const selectedPlayerById = new Map(selectedPlayers.map((player) => [player.player_id, player]));

  console.log(
    `Selected ${selectedPlayers.length} of ${allPlayers.length} players ` +
      `(peak value >= EUR ${(MIN_HIGHEST_MARKET_VALUE_EUR / 1_000_000).toFixed(0)}M OR >= ${MIN_INTERNATIONAL_CAPS} caps).`,
  );

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

  const referencedClubTmIds = new Set(derivedEdges.map((edge) => edge.clubTmId));

  console.log(
    `Derived ${derivedEdges.length} player-club stints across ${referencedClubTmIds.size} clubs ` +
      `from ${allTransfers.length} transfer rows (${skippedUnresolved} skipped as unresolved destinations).`,
  );

  if (dryRun) {
    console.log(
      `[dry-run] Would upsert up to ${selectedPlayers.length} players, ${referencedClubTmIds.size} clubs, ` +
        `${derivedEdges.length} edges. Re-run without --dry-run to write to the database.`,
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

    // Clubs: same batch-insert-then-lookup pattern, scoped to clubs actually referenced
    // by a derived edge (so nothing enters the table without at least one edge).
    const referencedClubs = Array.from(referencedClubTmIds, (tmId) => ({ tmId, ...clubByTmId.get(tmId)! }));
    for (const batch of chunk(referencedClubs, BATCH_SIZE)) {
      const values: unknown[] = [];
      const placeholders = batch.map((club, index) => {
        const base = index * 4;
        values.push(club.name, normalizeName(club.name), club.country, club.tmId);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4})`;
      });

      await client.query(
        `INSERT INTO clubs (canonical_name, normalized_name, country, source_entity_id)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (normalized_name) DO NOTHING`,
        values,
      );
    }

    const clubNormalizedNames = referencedClubs.map((club) => normalizeName(club.name));
    const clubIdRows = await client.query<{ id: string; normalized_name: string }>(
      `SELECT id, normalized_name FROM clubs WHERE normalized_name = ANY($1::text[])`,
      [clubNormalizedNames],
    );
    const clubDbIdByNormalizedName = new Map(clubIdRows.rows.map((row) => [row.normalized_name, Number(row.id)]));
    const clubDbIdByTmId = new Map<string, number>();
    for (const club of referencedClubs) {
      const dbId = clubDbIdByNormalizedName.get(normalizeName(club.name));
      if (dbId !== undefined) {
        clubDbIdByTmId.set(club.tmId, dbId);
      }
    }
    const clubsInserted = clubDbIdByTmId.size;

    // Edges
    let edgesInserted = 0;
    for (const batch of chunk(derivedEdges, BATCH_SIZE)) {
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let rowIndex = 0;
      for (const edge of batch) {
        const playerDbId = playerDbIdByTmId.get(edge.playerTmId);
        const clubDbId = clubDbIdByTmId.get(edge.clubTmId);
        if (playerDbId === undefined || clubDbId === undefined) continue;

        const base = rowIndex * 7;
        values.push(playerDbId, clubDbId, edge.startYear, edge.endYear, SOURCE_NAME, 1.0, datasetVersionId);
        placeholders.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
        rowIndex++;
      }
      if (placeholders.length === 0) continue;

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
    console.log(`Edges:   ${edgesInserted} newly inserted of ${derivedEdges.length} derived.`);

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
