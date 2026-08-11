import pg from "pg";

import { findShortestAnchorChain, type GraphEdge } from "./puzzle-generation/solver";

const { Pool } = pg;

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

    await client.query(
      `TRUNCATE TABLE daily_puzzles, player_clubs, users, players, clubs, data_versions RESTART IDENTITY CASCADE`
    );

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
      "Gianfranco Zola",
      "Neymar",
      "Sergio Ramos",
      "Thierry Henry",
      "David Beckham",
      "Paolo Maldini",
      "Andriy Shevchenko",
      "Michael Owen",
      "Edinson Cavani",
      "Philippe Coutinho",
    ];

    const clubs = [
      "Tottenham Hotspur",
      "Real Madrid",
      "Juventus",
      "AC Milan",
      "Paris Saint-Germain",
      "Barcelona",
      "Chelsea",
      "Al Hilal",
      "Borussia Dortmund",
      "Inter Milan",
      "Bayern Munich",
      "Arsenal",
      "New York Red Bulls",
      "Manchester United",
      "Liverpool",
      "LA Galaxy",
      "Ajax",
      "AS Roma",
      "Bayer Leverkusen",
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
      { player: "Harry Kane", club: "Bayern Munich", startYear: 2023 },
      { player: "Luka Modric", club: "Tottenham Hotspur", startYear: 2008, endYear: 2012 },
      { player: "Luka Modric", club: "Real Madrid", startYear: 2012 },
      { player: "Cristiano Ronaldo", club: "Real Madrid", startYear: 2009, endYear: 2018 },
      { player: "Cristiano Ronaldo", club: "Juventus", startYear: 2018, endYear: 2021 },
      { player: "Cristiano Ronaldo", club: "Al Hilal", startYear: 2023 },
      { player: "Andrea Pirlo", club: "Juventus", startYear: 2011, endYear: 2015 },
      { player: "Andrea Pirlo", club: "AC Milan", startYear: 2001, endYear: 2011 },
      { player: "Kaka", club: "AC Milan", startYear: 2003, endYear: 2009 },
      { player: "Kaka", club: "Real Madrid", startYear: 2009, endYear: 2013 },
      { player: "Ronaldinho", club: "Paris Saint-Germain", startYear: 2001, endYear: 2003 },
      { player: "Ronaldinho", club: "Barcelona", startYear: 2003, endYear: 2008 },
      { player: "Ronaldinho", club: "AC Milan", startYear: 2008, endYear: 2011 },
      { player: "Gianfranco Zola", club: "Chelsea", startYear: 1996, endYear: 2003 },
      { player: "Neymar", club: "Paris Saint-Germain", startYear: 2017, endYear: 2023 },
      { player: "Neymar", club: "Barcelona", startYear: 2013, endYear: 2017 },
      { player: "Sergio Ramos", club: "Real Madrid", startYear: 2005, endYear: 2021 },
      { player: "Sergio Ramos", club: "Paris Saint-Germain", startYear: 2021, endYear: 2023 },
      { player: "Thierry Henry", club: "Arsenal", startYear: 1999, endYear: 2007 },
      { player: "Thierry Henry", club: "Barcelona", startYear: 2007, endYear: 2010 },
      { player: "Thierry Henry", club: "Paris Saint-Germain", startYear: 2012, endYear: 2014 },
      { player: "Thierry Henry", club: "New York Red Bulls", startYear: 2010, endYear: 2014 },
      { player: "David Beckham", club: "Manchester United", startYear: 1992, endYear: 2003 },
      { player: "David Beckham", club: "Real Madrid", startYear: 2003, endYear: 2009 },
      { player: "David Beckham", club: "LA Galaxy", startYear: 2011, endYear: 2013 },
      { player: "Paolo Maldini", club: "AC Milan", startYear: 1984, endYear: 2009 },
      { player: "Andriy Shevchenko", club: "Chelsea", startYear: 2006, endYear: 2009 },
      { player: "Andriy Shevchenko", club: "AC Milan", startYear: 1999, endYear: 2006 },
      { player: "Michael Owen", club: "Liverpool", startYear: 1997, endYear: 2004 },
      { player: "Michael Owen", club: "Real Madrid", startYear: 2004, endYear: 2005 },
      { player: "Edinson Cavani", club: "Paris Saint-Germain", startYear: 2013, endYear: 2020 },
      { player: "Edinson Cavani", club: "Manchester United", startYear: 2020, endYear: 2022 },
      { player: "Philippe Coutinho", club: "Liverpool", startYear: 2013, endYear: 2018 },
      { player: "Philippe Coutinho", club: "Barcelona", startYear: 2018, endYear: 2022 },
      { player: "Philippe Coutinho", club: "Bayern Munich", startYear: 2022, endYear: 2023 },
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

    const graphEdges: GraphEdge[] = edges.map((edge) => ({
      playerId: playerIds.get(edge.player)!,
      clubId: clubIds.get(edge.club)!,
    }));

    const localToday = new Date();
    const puzzleDate = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(localToday);
    yesterday.setDate(localToday.getDate() - 1);
    const yesterdayDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    async function seedPuzzle(date: string, anchorNames: string[]): Promise<void> {
      const anchorIds = anchorNames.map((name) => {
        const id = playerIds.get(name);
        if (id === undefined) {
          throw new Error(`Unknown seeded player: ${name}`);
        }
        return id;
      });

      const chain = findShortestAnchorChain(anchorIds, graphEdges);
      if (!chain) {
        throw new Error(`No valid no-repeat chain connects the anchor players for ${date}: ${anchorNames.join(", ")}`);
      }

      const puzzleResult = await client.query<InsertIdRow>(
        `INSERT INTO daily_puzzles (puzzle_date, optimal_length, dataset_version_id, status, published_at)
         VALUES ($1, $2, $3, 'PUBLISHED', NOW())
         ON CONFLICT (puzzle_date)
         DO UPDATE SET
           optimal_length = EXCLUDED.optimal_length,
           dataset_version_id = EXCLUDED.dataset_version_id,
           status = 'PUBLISHED',
           published_at = NOW(),
           updated_at = NOW()
         RETURNING id`,
        [date, chain.length, datasetVersionId],
      );

      const puzzleId = Number(puzzleResult.rows[0].id);

      await client.query(`DELETE FROM daily_puzzle_players WHERE daily_puzzle_id = $1`, [puzzleId]);

      for (const anchorId of anchorIds) {
        await client.query(
          `INSERT INTO daily_puzzle_players (daily_puzzle_id, player_id) VALUES ($1, $2)`,
          [puzzleId, anchorId],
        );
      }
    }

    // Anchor sets are verified solvable (and optimal_length computed) by
    // findShortestAnchorChain against the real seeded edges above, rather than
    // hand-typed and trusted as before.
    await seedPuzzle(puzzleDate, ["Harry Kane", "Cristiano Ronaldo", "Ronaldinho"]);
    await seedPuzzle(yesterdayDate, ["Cristiano Ronaldo", "David Beckham", "Andriy Shevchenko"]);

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
