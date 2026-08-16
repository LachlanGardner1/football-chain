// Supplemental import: fills in players missing from the primary transfermarkt-datasets source
// entirely (it "prioritizes currently-rostered squads" - confirmed directly that retired legends
// like Sol Campbell, Dennis Bergkamp, and Tony Adams aren't in that raw CSV at all). Pulls from
// Wikidata's public SPARQL endpoint, which has real, dated club-career data for these players via
// P54 ("member of sports team") statements qualified by P580/P582 (start/end time).
//
// Every write here is additive-only: existing players/clubs are matched (never mutated), and
// only missing player_clubs edges are added. This deliberately does NOT touch normalizeName() or
// change what any existing row's normalized_name is - see scripts/normalize-name.ts's own
// warning comment about that specific risk (db/migrations/010_...).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Pool, PoolClient } from "pg";
import pg from "pg";

import { normalizeName } from "../normalize-name";

const { Pool: PgPool } = pg;

const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
// Wikimedia's User-Agent policy requires a descriptive UA identifying the project + a contact
// method - using the public repo URL rather than a personal email.
const USER_AGENT = "football-chain-data-import/1.0 (https://github.com/LachlanGardner1/football-chain)";
const CACHE_DIR = path.join(process.cwd(), "scripts/data-import/.cache/wikidata");
const SOURCE_NAME = "wikidata";
const ATTRIBUTE_BATCH_SIZE = 300;
const EDGE_BATCH_SIZE = 300;
const BATCH_SIZE = 500; // DB insert batching, same convention as import-transfermarkt.ts
const BIRTH_YEAR_MISMATCH_THRESHOLD_YEARS = 2;
const REQUEST_DELAY_MS = 200; // polite pacing between live (non-cached) requests

const FOOTBALLER_OCCUPATION_QID = "Q937857";
const REAL_CLUB_CLASS_QID = "Q476028";
const NATIONAL_TEAM_CLASS_QIDS = ["Q6979593", "Q135408445"];

interface SparqlBinding {
  [key: string]: { type: string; value: string } | undefined;
}

export interface WikidataPlayerCandidate {
  qid: string;
  tmId: string | null;
  canonicalName: string;
  dob: string | null;
  birthYear: number | null;
  country: string | null;
}

export interface WikidataClubRef {
  qid: string;
  tmId: string | null;
  canonicalName: string;
  country: string | null;
}

export interface WikidataEdge {
  playerQid: string;
  club: WikidataClubRef;
  startYear: number | null;
  endYear: number | null;
}

export interface ExistingPlayerRow {
  id: number;
  normalizedName: string;
  sourceEntityId: string | null;
  birthYear: number | null;
}

export interface ExistingClubRow {
  id: number;
  normalizedName: string;
  sourceEntityId: string | null;
}

export type PlayerMatch =
  | { kind: "id"; existing: ExistingPlayerRow }
  | { kind: "name"; existing: ExistingPlayerRow }
  | { kind: "ambiguous" } // name matched, but birth years differ too much - do not merge
  | { kind: "none" };

export type ClubMatch =
  | { kind: "id"; existing: ExistingClubRow }
  | { kind: "name"; existing: ExistingClubRow }
  | { kind: "none" };

// Priority: (a) source_entity_id (Transfermarkt ID) exact match - trusted unconditionally, no
// birth-year cross-check (a false ID collision would be a Wikidata data error, not something
// this heuristic could usefully catch); (b) normalized_name match with a birth-year sanity guard
// (only fires when BOTH sides have a known birth year, so a missing dob on either side falls
// through to accepting the name match); (c) no match => caller inserts a new row.
export function resolvePlayerMatch(
  candidate: { tmId: string | null; normalizedName: string; birthYear: number | null },
  existingByTmId: Map<string, ExistingPlayerRow>,
  existingByNormalizedName: Map<string, ExistingPlayerRow>,
  mismatchThresholdYears = BIRTH_YEAR_MISMATCH_THRESHOLD_YEARS,
): PlayerMatch {
  if (candidate.tmId) {
    const byId = existingByTmId.get(candidate.tmId);
    if (byId) return { kind: "id", existing: byId };
  }
  const byName = existingByNormalizedName.get(candidate.normalizedName);
  if (byName) {
    const bothKnown = candidate.birthYear != null && byName.birthYear != null;
    if (bothKnown && Math.abs(candidate.birthYear! - byName.birthYear!) > mismatchThresholdYears) {
      return { kind: "ambiguous" };
    }
    return { kind: "name", existing: byName };
  }
  return { kind: "none" };
}

export function resolveClubMatch(
  candidate: { tmId: string | null; normalizedName: string },
  existingByTmId: Map<string, ExistingClubRow>,
  existingByNormalizedName: Map<string, ExistingClubRow>,
): ClubMatch {
  if (candidate.tmId) {
    const byId = existingByTmId.get(candidate.tmId);
    if (byId) return { kind: "id", existing: byId };
  }
  const byName = existingByNormalizedName.get(candidate.normalizedName);
  if (byName) return { kind: "name", existing: byName };
  return { kind: "none" };
}

// Wikidata dateTime literals are ISO 8601 ("1998-06-01T00:00:00Z") regardless of the source
// statement's actual precision - slicing the first 4 chars mirrors the same convention
// import-transfermarkt.ts already uses on transfer_date strings.
export function extractYear(dateTimeLiteral: string | null | undefined): number | null {
  if (!dateTimeLiteral) return null;
  const year = Number(dateTimeLiteral.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export function qidFromUri(uri: string): string {
  return uri.replace("http://www.wikidata.org/entity/", "");
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

// Wikidata is crowd-edited, so a small number of statements are malformed - confirmed live: at
// least one P569 (date of birth) value was actually a URI, not a dateTime literal, which
// `.slice(0, 10)` would silently truncate into something that merely LOOKS like a date (e.g.
// "http://www") and which Postgres then rejects at insert time. Validate the shape before
// trusting it rather than assuming every dob binding is well-formed.
export function extractIsoDate(dateTimeLiteral: string | null | undefined): string | null {
  if (!dateTimeLiteral) return null;
  const datePart = dateTimeLiteral.slice(0, 10);
  return ISO_DATE_PATTERN.test(datePart) ? datePart : null;
}

// player_clubs has a CHECK (start_year <= end_year) constraint - confirmed live that at least
// one real Wikidata P54 statement has its P580/P582 (start/end time) qualifiers reversed (a
// crowd-sourced data-entry error), which would otherwise crash the insert. Rather than guessing
// which of the two years is the mistake, skip the edge entirely when both are present and
// inconsistent - the constraint is a legitimate data-integrity guarantee this script must
// respect, not something to work around by force.
export function hasValidYearRange(startYear: number | null, endYear: number | null): boolean {
  if (startYear == null || endYear == null) return true;
  return startYear <= endYear;
}

// Deliberately no ORDER BY / GROUP BY / aggregation here - confirmed live that adding any of
// those (needed only for pagination + collapsing a player's possibly-multiple qualifying
// national-team statements into one row) forces the query engine to sort/aggregate the ENTIRE
// ~70k-row match set before applying LIMIT/OFFSET, which times out (504) even at LIMIT 2,000. A
// bare SELECT DISTINCT with no ordering returns all ~70,381 rows in one shot in ~7s. Attribute
// data (Transfermarkt id, dob, country, label) is fetched separately, batched by QID via
// buildCandidateAttributesQuery - see fetchAllCandidates.
export function buildCandidateQidsQuery(): string {
  const natClassValues = NATIONAL_TEAM_CLASS_QIDS.map((qid) => `wd:${qid}`).join(" ");
  return `SELECT DISTINCT ?player WHERE {
  ?player wdt:P106 wd:${FOOTBALLER_OCCUPATION_QID} .
  ?player p:P54 ?natStatement .
  ?natStatement ps:P54 ?natTeam .
  ?natTeam wdt:P31 ?natClass .
  VALUES ?natClass { ${natClassValues} }
}`;
}

// Batched (VALUES-scoped) attribute lookup for a chunk of already-known-qualifying QIDs - cheap
// because it's bounded to the batch, not aggregated over the whole candidate set. A player with
// multiple citizenships (P27) can produce more than one row here; callers should dedupe by QID,
// first-seen-wins.
export function buildCandidateAttributesQuery(qids: string[]): string {
  const values = qids.map((qid) => `wd:${qid}`).join(" ");
  return `SELECT ?player ?tmId ?dob ?countryLabel ?playerLabel WHERE {
  VALUES ?player { ${values} }
  OPTIONAL { ?player rdfs:label ?playerLabel . FILTER(LANG(?playerLabel) = "en") }
  OPTIONAL { ?player wdt:P2446 ?tmId . }
  OPTIONAL { ?player wdt:P569 ?dob . }
  OPTIONAL { ?player wdt:P27 ?countryEntity . ?countryEntity rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en") }
}`;
}

export function buildEdgesQuery(qids: string[]): string {
  const values = qids.map((qid) => `wd:${qid}`).join(" ");
  return `SELECT ?player ?team ?tmTeamId ?teamLabel ?teamCountryLabel ?start ?end WHERE {
  VALUES ?player { ${values} }
  ?player p:P54 ?statement .
  ?statement ps:P54 ?team .
  ?team wdt:P31 wd:${REAL_CLUB_CLASS_QID} .
  ?team rdfs:label ?teamLabel . FILTER(LANG(?teamLabel) = "en")
  OPTIONAL { ?team wdt:P7223 ?tmTeamId . }
  OPTIONAL { ?team wdt:P17 ?teamCountryEntity . ?teamCountryEntity rdfs:label ?teamCountryLabel . FILTER(LANG(?teamCountryLabel) = "en") }
  OPTIONAL { ?statement pq:P580 ?start . }
  OPTIONAL { ?statement pq:P582 ?end . }
}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 2_000;

async function runSparqlQuery(query: string, cacheFile: string): Promise<SparqlBinding[]> {
  const cachePath = path.join(CACHE_DIR, cacheFile);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf-8"));
    return cached.results.bindings;
  }

  mkdirSync(CACHE_DIR, { recursive: true });

  // The public endpoint is flaky at the request volume this script needs (confirmed live: a
  // transient 502 mid-run, unrelated to query cost - the same query succeeds on retry). Retry
  // transient gateway/rate-limit errors with exponential backoff rather than aborting the whole
  // run; a real query error (4xx other than 429) fails immediately since retrying it is pointless.
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(WIKIDATA_SPARQL_ENDPOINT, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `query=${encodeURIComponent(query)}&format=json`,
      });

      if (!response.ok) {
        const bodyText = await response.text();
        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
          console.log(`  Wikidata query failed (HTTP ${response.status}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`Wikidata SPARQL query failed: HTTP ${response.status} ${bodyText}`);
      }

      const json = await response.json();
      writeFileSync(cachePath, JSON.stringify(json), "utf-8");
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
      return json.results.bindings;
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message.startsWith("Wikidata SPARQL query failed")) throw error;
      if (attempt >= MAX_RETRIES) throw error;
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      console.log(`  Wikidata request errored (${(error as Error).message}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function fetchAllCandidates(): Promise<{ candidates: WikidataPlayerCandidate[]; skippedNoLabel: number }> {
  const qidBindings = await runSparqlQuery(buildCandidateQidsQuery(), "candidate-qids.json");
  const qids = qidBindings.map((b) => qidFromUri(b.player!.value));
  console.log(`  found ${qids.length} qualifying candidate QIDs, fetching attributes...`);

  const candidates: WikidataPlayerCandidate[] = [];
  const seenQids = new Set<string>();
  let skippedNoLabel = 0;
  const batches = chunk(qids, ATTRIBUTE_BATCH_SIZE);

  for (const [i, batch] of batches.entries()) {
    const bindings = await runSparqlQuery(buildCandidateAttributesQuery(batch), `candidate-attrs-${i}.json`);
    for (const b of bindings) {
      const qid = qidFromUri(b.player!.value);
      if (seenQids.has(qid)) continue; // a player with multiple citizenships (P27) can produce >1 row
      const label = b.playerLabel?.value;
      if (!label) {
        skippedNoLabel++;
        seenQids.add(qid);
        continue;
      }
      seenQids.add(qid);
      const dob = extractIsoDate(b.dob?.value);
      candidates.push({
        qid,
        tmId: b.tmId?.value ?? null,
        canonicalName: label,
        dob,
        birthYear: dob ? extractYear(dob) : null,
        country: b.countryLabel?.value ?? null,
      });
    }
    if ((i + 1) % 20 === 0 || i === batches.length - 1) {
      console.log(`  attribute batch ${i + 1}/${batches.length}`);
    }
  }

  return { candidates, skippedNoLabel };
}

async function fetchEdgesForQids(qids: string[]): Promise<WikidataEdge[]> {
  const edges: WikidataEdge[] = [];
  const batches = chunk(qids, EDGE_BATCH_SIZE);

  for (const [i, batch] of batches.entries()) {
    const bindings = await runSparqlQuery(buildEdgesQuery(batch), `edges-${i}.json`);
    for (const b of bindings) {
      edges.push({
        playerQid: qidFromUri(b.player!.value),
        club: {
          qid: qidFromUri(b.team!.value),
          tmId: b.tmTeamId?.value ?? null,
          canonicalName: b.teamLabel!.value,
          country: b.teamCountryLabel?.value ?? null,
        },
        startYear: extractYear(b.start?.value),
        endYear: extractYear(b.end?.value),
      });
    }
    console.log(`  edge batch ${i + 1}/${batches.length}: ${bindings.length} stint row(s)`);
  }

  return edges;
}

interface ImportSummary {
  candidateCount: number;
  skippedNoLabel: number;
  edgeRowCount: number;
  matchedById: number;
  matchedByName: number;
  ambiguousSkipped: number;
  newPlayers: number;
  clubMatchedById: number;
  clubMatchedByName: number;
  newClubs: number;
  newPlayerEdges: number;
  supplementalEdges: number;
  skippedInvalidYearRange: number;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  console.log("Fetching candidate players from Wikidata (cached under scripts/data-import/.cache/wikidata/)...");
  const { candidates, skippedNoLabel } = await fetchAllCandidates();
  console.log(`Fetched ${candidates.length} candidate players from Wikidata (${skippedNoLabel} skipped: no English label).`);

  console.log("Fetching club-career edges for candidates...");
  const allEdges = await fetchEdgesForQids(candidates.map((c) => c.qid));
  const edgesByPlayerQid = new Map<string, WikidataEdge[]>();
  for (const edge of allEdges) {
    const list = edgesByPlayerQid.get(edge.playerQid) ?? [];
    list.push(edge);
    edgesByPlayerQid.set(edge.playerQid, list);
  }
  console.log(`Fetched ${allEdges.length} player-club stint row(s).`);

  const pool = new PgPool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const versionResult = await client.query<{ id: string }>(`SELECT id FROM data_versions WHERE is_active = TRUE LIMIT 1`);
    if (versionResult.rowCount === 0) {
      throw new Error("No active data_versions row found. Run `npm run db:seed` first to establish a baseline dataset version.");
    }
    const datasetVersionId = Number(versionResult.rows[0].id);

    const existingPlayerRows = await client.query<{ id: string; normalized_name: string; source_entity_id: string | null; dob: Date | null }>(
      `SELECT id, normalized_name, source_entity_id, dob FROM players`,
    );
    const existingPlayerByTmId = new Map<string, ExistingPlayerRow>();
    const existingPlayerByNormalizedName = new Map<string, ExistingPlayerRow>();
    for (const row of existingPlayerRows.rows) {
      const player: ExistingPlayerRow = {
        id: Number(row.id),
        normalizedName: row.normalized_name,
        sourceEntityId: row.source_entity_id,
        birthYear: row.dob ? row.dob.getUTCFullYear() : null,
      };
      if (row.source_entity_id) existingPlayerByTmId.set(row.source_entity_id, player);
      existingPlayerByNormalizedName.set(row.normalized_name, player);
    }

    const existingClubRows = await client.query<{ id: string; normalized_name: string; source_entity_id: string | null }>(
      `SELECT id, normalized_name, source_entity_id FROM clubs`,
    );
    const existingClubByTmId = new Map<string, ExistingClubRow>();
    const existingClubByNormalizedName = new Map<string, ExistingClubRow>();
    for (const row of existingClubRows.rows) {
      const club: ExistingClubRow = { id: Number(row.id), normalizedName: row.normalized_name, sourceEntityId: row.source_entity_id };
      if (row.source_entity_id) existingClubByTmId.set(row.source_entity_id, club);
      existingClubByNormalizedName.set(row.normalized_name, club);
    }

    // Resolve every candidate to a decision: matched-existing, ambiguous (skip), or new.
    const summary: ImportSummary = {
      candidateCount: candidates.length,
      skippedNoLabel,
      edgeRowCount: allEdges.length,
      matchedById: 0,
      matchedByName: 0,
      ambiguousSkipped: 0,
      newPlayers: 0,
      clubMatchedById: 0,
      clubMatchedByName: 0,
      newClubs: 0,
      newPlayerEdges: 0,
      supplementalEdges: 0,
      skippedInvalidYearRange: 0,
    };

    const matchedPlayerDbIdByQid = new Map<string, number>();
    const newPlayerCandidates: WikidataPlayerCandidate[] = [];
    const isNewPlayerQid = new Set<string>();
    // New candidates get a placeholder id immediately (negative, never a real players.id) so the
    // edge-retention/counting logic below works uniformly in --dry-run too, where no row is ever
    // actually inserted. Real runs overwrite these with the true DB id once new players are
    // inserted (see the follow-up SELECT below) - purely a bookkeeping key, never written to the
    // DB and never used once the real id is assigned.
    let nextPlaceholderId = -1;

    for (const candidate of candidates) {
      const match = resolvePlayerMatch(
        { tmId: candidate.tmId, normalizedName: normalizeName(candidate.canonicalName), birthYear: candidate.birthYear },
        existingPlayerByTmId,
        existingPlayerByNormalizedName,
      );
      if (match.kind === "id") {
        summary.matchedById++;
        matchedPlayerDbIdByQid.set(candidate.qid, match.existing.id);
      } else if (match.kind === "name") {
        summary.matchedByName++;
        matchedPlayerDbIdByQid.set(candidate.qid, match.existing.id);
      } else if (match.kind === "ambiguous") {
        summary.ambiguousSkipped++;
      } else {
        summary.newPlayers++;
        newPlayerCandidates.push(candidate);
        isNewPlayerQid.add(candidate.qid);
        matchedPlayerDbIdByQid.set(candidate.qid, nextPlaceholderId--);
      }
    }

    // Insert new players, batched, same-batch dedup by normalized name first-seen-wins (mirrors
    // import-transfermarkt.ts's seenNormalizedNames pattern - two Wikidata candidates in the same
    // batch normalizing to the same key would otherwise error under a single INSERT statement).
    for (const batch of chunk(newPlayerCandidates, BATCH_SIZE)) {
      const seenNormalizedNames = new Set<string>();
      const dedupedBatch = batch.filter((candidate) => {
        const key = normalizeName(candidate.canonicalName);
        if (seenNormalizedNames.has(key)) return false;
        seenNormalizedNames.add(key);
        return true;
      });

      if (dedupedBatch.length === 0) continue;

      const values: unknown[] = [];
      const placeholders = dedupedBatch.map((candidate, index) => {
        const base = index * 5;
        values.push(
          candidate.canonicalName,
          normalizeName(candidate.canonicalName),
          candidate.dob,
          candidate.country,
          candidate.tmId ?? `wikidata:${candidate.qid}`,
        );
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`;
      });

      if (!dryRun) {
        await client.query(
          `INSERT INTO players (canonical_name, normalized_name, dob, country, source_entity_id)
           VALUES ${placeholders.join(",")}
           ON CONFLICT (normalized_name) DO NOTHING`,
          values,
        );
      }
    }

    if (!dryRun && newPlayerCandidates.length > 0) {
      const newPlayerNormalizedNames = newPlayerCandidates.map((c) => normalizeName(c.canonicalName));
      const newPlayerIdRows = await client.query<{ id: string; normalized_name: string }>(
        `SELECT id, normalized_name FROM players WHERE normalized_name = ANY($1::text[])`,
        [newPlayerNormalizedNames],
      );
      const newPlayerDbIdByNormalizedName = new Map(newPlayerIdRows.rows.map((row) => [row.normalized_name, Number(row.id)]));
      for (const candidate of newPlayerCandidates) {
        const dbId = newPlayerDbIdByNormalizedName.get(normalizeName(candidate.canonicalName));
        if (dbId !== undefined) matchedPlayerDbIdByQid.set(candidate.qid, dbId);
      }
    }

    // Additive-only coverage guard for matched (already-existing) players: only add supplemental
    // edges for clubs NOT already covered by that player's real current DB coverage. This is a
    // read-only query, safe (and necessary for an accurate --dry-run report) to run regardless
    // of dryRun - only the actual INSERTs later are gated on it.
    const matchedExistingPlayerIds = [...matchedPlayerDbIdByQid.entries()]
      .filter(([qid]) => !isNewPlayerQid.has(qid))
      .map(([, id]) => id);
    const existingCoverageByPlayerId = new Map<number, Set<string>>();
    if (matchedExistingPlayerIds.length > 0) {
      const coverageRows = await client.query<{ player_id: string; normalized_name: string }>(
        `SELECT pc.player_id, c.normalized_name
         FROM player_clubs pc JOIN clubs c ON c.id = pc.club_id
         WHERE pc.player_id = ANY($1::bigint[])`,
        [matchedExistingPlayerIds],
      );
      for (const row of coverageRows.rows) {
        const playerId = Number(row.player_id);
        const set = existingCoverageByPlayerId.get(playerId) ?? new Set<string>();
        set.add(row.normalized_name);
        existingCoverageByPlayerId.set(playerId, set);
      }
    }

    // Retain edges: new players keep every real-club edge; matched players keep only edges for
    // clubs not already covered by their existing real data.
    const retainedEdges: Array<{ playerDbId: number; club: WikidataClubRef; startYear: number | null; endYear: number | null }> = [];
    for (const [qid, playerDbId] of matchedPlayerDbIdByQid) {
      const edges = edgesByPlayerQid.get(qid) ?? [];
      if (isNewPlayerQid.has(qid)) {
        for (const edge of edges) {
          if (!hasValidYearRange(edge.startYear, edge.endYear)) {
            summary.skippedInvalidYearRange++;
            continue;
          }
          retainedEdges.push({ playerDbId, club: edge.club, startYear: edge.startYear, endYear: edge.endYear });
          summary.newPlayerEdges++;
        }
      } else {
        const covered = existingCoverageByPlayerId.get(playerDbId) ?? new Set<string>();
        for (const edge of edges) {
          if (!hasValidYearRange(edge.startYear, edge.endYear)) {
            summary.skippedInvalidYearRange++;
            continue;
          }
          const key = normalizeName(edge.club.canonicalName);
          if (covered.has(key)) continue;
          retainedEdges.push({ playerDbId, club: edge.club, startYear: edge.startYear, endYear: edge.endYear });
          covered.add(key); // avoid inserting the same new club twice within this run too
          summary.supplementalEdges++;
        }
      }
    }

    // Resolve clubs referenced by retained edges (id-then-name-then-insert-new), scoped to only
    // clubs actually referenced (mirrors referencedClubsByNormalizedName in import-transfermarkt.ts).
    const referencedClubsByNormalizedName = new Map<string, WikidataClubRef>();
    for (const edge of retainedEdges) {
      const key = normalizeName(edge.club.canonicalName);
      if (!referencedClubsByNormalizedName.has(key)) referencedClubsByNormalizedName.set(key, edge.club);
    }

    const clubDbIdByNormalizedName = new Map<string, number>();
    const newClubRefs: WikidataClubRef[] = [];
    for (const [key, club] of referencedClubsByNormalizedName) {
      const match = resolveClubMatch({ tmId: club.tmId, normalizedName: key }, existingClubByTmId, existingClubByNormalizedName);
      if (match.kind === "id") {
        summary.clubMatchedById++;
        clubDbIdByNormalizedName.set(key, match.existing.id);
      } else if (match.kind === "name") {
        summary.clubMatchedByName++;
        clubDbIdByNormalizedName.set(key, match.existing.id);
      } else {
        summary.newClubs++;
        newClubRefs.push(club);
      }
    }

    for (const batch of chunk(newClubRefs, BATCH_SIZE)) {
      const values: unknown[] = [];
      const placeholders = batch.map((club, index) => {
        const base = index * 4;
        values.push(club.canonicalName, normalizeName(club.canonicalName), club.country, club.tmId ?? `wikidata:${club.qid}`);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4})`;
      });

      if (!dryRun) {
        await client.query(
          `INSERT INTO clubs (canonical_name, normalized_name, country, source_entity_id)
           VALUES ${placeholders.join(",")}
           ON CONFLICT (normalized_name) DO NOTHING`,
          values,
        );
      }
    }

    if (!dryRun && newClubRefs.length > 0) {
      const newClubNormalizedNames = newClubRefs.map((club) => normalizeName(club.canonicalName));
      const newClubIdRows = await client.query<{ id: string; normalized_name: string }>(
        `SELECT id, normalized_name FROM clubs WHERE normalized_name = ANY($1::text[])`,
        [newClubNormalizedNames],
      );
      for (const row of newClubIdRows.rows) clubDbIdByNormalizedName.set(row.normalized_name, Number(row.id));
    }

    let edgesInserted = 0;
    if (!dryRun) {
      const resolvedEdges = retainedEdges
        .map((edge) => ({
          playerDbId: edge.playerDbId,
          clubDbId: clubDbIdByNormalizedName.get(normalizeName(edge.club.canonicalName)),
          startYear: edge.startYear,
          endYear: edge.endYear,
        }))
        .filter((edge): edge is { playerDbId: number; clubDbId: number; startYear: number | null; endYear: number | null } => edge.clubDbId !== undefined);

      // Same-batch dedup on (playerDbId, clubDbId, startYear, endYear) first-seen-wins.
      for (const batch of chunk(resolvedEdges, BATCH_SIZE)) {
        const seenKeys = new Set<string>();
        const dedupedBatch = batch.filter((edge) => {
          const key = `${edge.playerDbId}:${edge.clubDbId}:${edge.startYear}:${edge.endYear}`;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });

        const values: unknown[] = [];
        const placeholders = dedupedBatch.map((edge, index) => {
          const base = index * 7;
          values.push(edge.playerDbId, edge.clubDbId, edge.startYear, edge.endYear, SOURCE_NAME, 1.0, datasetVersionId);
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
        });

        const result = await client.query(
          `INSERT INTO player_clubs (player_id, club_id, start_year, end_year, source_name, confidence, dataset_version_id)
           VALUES ${placeholders.join(",")}
           ON CONFLICT (player_id, club_id, dataset_version_id, start_year, end_year) DO NOTHING`,
          values,
        );
        edgesInserted += result.rowCount ?? 0;
      }
    }

    if (dryRun) {
      await client.query("ROLLBACK");
      console.log(`
Player matches:
  by source_entity_id (Transfermarkt ID): ${summary.matchedById}
  by normalized_name:                     ${summary.matchedByName}
  ambiguous (birth-year mismatch > ${BIRTH_YEAR_MISMATCH_THRESHOLD_YEARS}y), skipped: ${summary.ambiguousSkipped}
  genuinely new players:                  ${summary.newPlayers}

Club matches (for referenced clubs only):
  by source_entity_id: ${summary.clubMatchedById}
  by normalized_name:  ${summary.clubMatchedByName}
  new clubs:           ${summary.newClubs}

[dry-run] Would insert ${summary.newPlayers} new players, ${summary.newClubs} new clubs, ${retainedEdges.length} new player_clubs edges
          (${summary.newPlayerEdges} for new players, ${summary.supplementalEdges} supplemental for existing players).
          ${summary.skippedInvalidYearRange} edge(s) skipped for an inconsistent start/end year (Wikidata data-entry error).
Re-run without --dry-run to write to the database.`);
    } else {
      await client.query("COMMIT");
      console.log(`
Import complete.
Players: ${summary.newPlayers} new (of ${summary.candidateCount} candidates; ${summary.matchedById} matched by id, ${summary.matchedByName} by name, ${summary.ambiguousSkipped} ambiguous-skipped).
Clubs:   ${summary.newClubs} new (${summary.clubMatchedById} matched by id, ${summary.clubMatchedByName} by name).
Edges:   ${edgesInserted} newly inserted (${summary.newPlayerEdges} for new players, ${summary.supplementalEdges} supplemental for existing players; ${summary.skippedInvalidYearRange} skipped for an inconsistent start/end year).`);

      console.log(`\nSpot-check (known previously-missing legends):`);
      for (const name of ["Sol Campbell", "Dennis Bergkamp", "Tony Adams"]) {
        const result = await client.query<{ canonical_name: string; club: string; start_year: number | null; end_year: number | null }>(
          `SELECT c.canonical_name AS club, pc.start_year, pc.end_year
           FROM player_clubs pc
           JOIN players p ON p.id = pc.player_id
           JOIN clubs c ON c.id = pc.club_id
           WHERE p.normalized_name = $1
           ORDER BY pc.start_year`,
          [normalizeName(name)],
        );
        console.log(`  ${name}: ${result.rows.map((r) => `${r.club} (${r.start_year ?? "?"}-${r.end_year ?? "?"})`).join(", ") || "(not found)"}`);
      }
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
