import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;

// Resolved two ways because this file runs in two different module shapes: as a real ESM
// module under tsx (the CLI path, `import.meta.url` is valid), and bundled to CJS by esbuild
// for the ops Lambda (scripts/build-ops-lambda.mjs), where `import.meta.url` is empty but a
// real CJS `__dirname` exists instead. `typeof __dirname` is the one reference JS allows on a
// possibly-undeclared identifier without throwing, so this is safe in both.
const scriptDir =
  typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(scriptDir, "../db/migrations");

// Applies every not-yet-applied migration in db/migrations, in filename order, each in its
// own transaction. Shared by the CLI entrypoint below and the ops Lambda's "migrate" action
// (scripts/ops-lambda/handler.ts) - RDS is private, so the Lambda is the only thing that can
// reach it once deployed.
export async function runMigrations(pool: pg.Pool): Promise<void> {
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

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
  }
}

async function runFromCli(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

// import.meta.url check keeps this file importable (for its runMigrations export) without
// re-running the CLI path as a side effect. Compared via pathToFileURL (not a hand-built
// `file://${...}` template) because process.argv[1] is a plain OS path - on Windows that's
// backslash-separated with a drive letter (C:\...), which doesn't string-match the
// forward-slash file:// URL import.meta.url actually produces (file:///C:/...).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runFromCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
