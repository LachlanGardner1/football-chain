import pg from "pg";

const { Pool } = pg;

interface GraphEdge {
  playerId: number;
  clubId: number;
}

interface GraphNode {
  id: number;
  type: "PLAYER" | "CLUB";
}

function toNodeId(node: GraphNode): string {
  return `${node.type}:${node.id}`;
}

function buildShortestPathLength(startPlayerId: number, targetPlayerId: number, edges: GraphEdge[]): number | null {
  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    const playerNode = { id: edge.playerId, type: "PLAYER" as const };
    const clubNode = { id: edge.clubId, type: "CLUB" as const };

    const playerId = toNodeId(playerNode);
    const clubId = toNodeId(clubNode);

    if (!adjacency.has(playerId)) adjacency.set(playerId, new Set<string>());
    if (!adjacency.has(clubId)) adjacency.set(clubId, new Set<string>());

    adjacency.get(playerId)!.add(clubId);
    adjacency.get(clubId)!.add(playerId);
  }

  const startNodeId = toNodeId({ id: startPlayerId, type: "PLAYER" });
  const targetNodeId = toNodeId({ id: targetPlayerId, type: "PLAYER" });

  if (startNodeId === targetNodeId) return 1;

  const queue: string[][] = [[startNodeId]];
  const visited = new Set<string>([startNodeId]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const currentNodeId = path[path.length - 1];

    if (currentNodeId === targetNodeId) {
      return path.length;
    }

    const neighbors = adjacency.get(currentNodeId);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push([...path, neighbor]);
    }
  }

  return null;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

interface InsertIdRow {
  id: string;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const versionResult = await client.query<InsertIdRow>(
      `INSERT INTO data_versions (version_key, source_name, is_active, notes)
       VALUES ($1, $2, TRUE, $3)
       ON CONFLICT (version_key)
       DO UPDATE SET is_active = TRUE
       RETURNING id`,
      ["dev-seed-v1", "manual-dev-seed", "Local dev seed dataset"],
    );

    const datasetVersionId = Number(versionResult.rows[0].id);

    await client.query(
      `UPDATE data_versions
       SET is_active = FALSE
       WHERE id <> $1`,
      [datasetVersionId],
    );

    const players = [
      "Harry Kane",
      "Luka Modric",
      "Cristiano Ronaldo",
      "Andrea Pirlo",
      "Ronaldinho",
      "Kaka",
    ];

    const clubs = [
      "Tottenham Hotspur",
      "Real Madrid",
      "Juventus",
      "AC Milan",
      "Paris Saint-Germain",
      "Barcelona",
    ];

    const playerIds = new Map<string, number>();
    for (const playerName of players) {
      const result = await client.query<InsertIdRow>(
        `INSERT INTO players (canonical_name, normalized_name)
         VALUES ($1, $2)
         ON CONFLICT (normalized_name) DO NOTHING
         RETURNING id`,
        [playerName, normalizeName(playerName)],
      );

      if (result.rowCount && result.rowCount > 0) {
        playerIds.set(playerName, Number(result.rows[0].id));
      } else {
        const existing = await client.query<InsertIdRow>(
          `SELECT id
           FROM players
           WHERE normalized_name = $1
           LIMIT 1`,
          [normalizeName(playerName)],
        );
        playerIds.set(playerName, Number(existing.rows[0].id));
      }
    }

    const clubIds = new Map<string, number>();
    for (const clubName of clubs) {
      const result = await client.query<InsertIdRow>(
        `INSERT INTO clubs (canonical_name, normalized_name)
         VALUES ($1, $2)
         ON CONFLICT (normalized_name) DO NOTHING
         RETURNING id`,
        [clubName, normalizeName(clubName)],
      );

      if (result.rowCount && result.rowCount > 0) {
        clubIds.set(clubName, Number(result.rows[0].id));
      } else {
        const existing = await client.query<InsertIdRow>(
          `SELECT id
           FROM clubs
           WHERE normalized_name = $1
           LIMIT 1`,
          [normalizeName(clubName)],
        );
        clubIds.set(clubName, Number(existing.rows[0].id));
      }
    }

    const edges: Array<{ player: string; club: string; startYear?: number; endYear?: number }> = [
      { player: "Harry Kane", club: "Tottenham Hotspur", startYear: 2011, endYear: 2023 },
      { player: "Luka Modric", club: "Tottenham Hotspur", startYear: 2008, endYear: 2012 },
      { player: "Luka Modric", club: "Real Madrid", startYear: 2012 },
      { player: "Cristiano Ronaldo", club: "Real Madrid", startYear: 2009, endYear: 2018 },
      { player: "Cristiano Ronaldo", club: "Juventus", startYear: 2018, endYear: 2021 },
      { player: "Andrea Pirlo", club: "Juventus", startYear: 2011, endYear: 2015 },
      { player: "Andrea Pirlo", club: "AC Milan", startYear: 2001, endYear: 2011 },
      { player: "Kaka", club: "AC Milan", startYear: 2003, endYear: 2009 },
      { player: "Kaka", club: "Real Madrid", startYear: 2009, endYear: 2013 },
      { player: "Ronaldinho", club: "Paris Saint-Germain", startYear: 2001, endYear: 2003 },
      { player: "Ronaldinho", club: "Barcelona", startYear: 2003, endYear: 2008 },
      { player: "Ronaldinho", club: "AC Milan", startYear: 2008, endYear: 2011 },
    ];

    for (const edge of edges) {
      await client.query(
        `INSERT INTO player_clubs (
           player_id,
           club_id,
           start_year,
           end_year,
           source_name,
           confidence,
           dataset_version_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (player_id, club_id, dataset_version_id, start_year, end_year)
         DO NOTHING`,
        [
          playerIds.get(edge.player),
          clubIds.get(edge.club),
          edge.startYear ?? null,
          edge.endYear ?? null,
          "manual-dev-seed",
          1.0,
          datasetVersionId,
        ],
      );
    }

    const graphEdges = edges.map((edge) => ({
      playerId: playerIds.get(edge.player)!,
      clubId: clubIds.get(edge.club)!,
    }));

    const optimalLength = buildShortestPathLength(
      playerIds.get("Harry Kane")!,
      playerIds.get("Ronaldinho")!,
      graphEdges,
    );

    if (optimalLength === null) {
      throw new Error("Could not compute shortest path for the seeded daily puzzle.");
    }

    await client.query(
      `INSERT INTO daily_puzzles (
         puzzle_date,
         start_player_id,
         target_player_id,
         optimal_length,
         dataset_version_id,
         status,
         published_at
       )
       VALUES ($1, $2, $3, $4, $5, 'PUBLISHED', NOW())
       ON CONFLICT (puzzle_date)
       DO UPDATE SET
         start_player_id = EXCLUDED.start_player_id,
         target_player_id = EXCLUDED.target_player_id,
         optimal_length = EXCLUDED.optimal_length,
         dataset_version_id = EXCLUDED.dataset_version_id,
         status = 'PUBLISHED',
         published_at = NOW(),
         updated_at = NOW()`,
      [
        new Date().toISOString().slice(0, 10),
        playerIds.get("Harry Kane"),
        playerIds.get("Ronaldinho"),
        optimalLength,
        datasetVersionId,
      ],
    );

    await client.query(
      `INSERT INTO users (id, username)
       VALUES ($1::uuid, $2)
       ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username`,
      ["11111111-1111-4111-8111-111111111111", "dev-user"],
    );

    await client.query("COMMIT");
    console.log("Seed complete.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
