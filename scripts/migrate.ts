import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../db/migrations");

async function run(): Promise<void> {
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const file of files) {
      const alreadyApplied = await client.query<{ filename: string }>(
        "SELECT filename FROM schema_migrations WHERE filename = $1",
        [file],
      );

      if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      console.log(`Applied migration: ${file}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
