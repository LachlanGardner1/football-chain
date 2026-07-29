import { Pool } from "pg";

function buildDatabaseUrlFromParts(): string | null {
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT ?? "5432";
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const name = process.env.DB_NAME;

  if (!host || !user || !password || !name) {
    return null;
  }

  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

const databaseUrl = process.env.DATABASE_URL ?? buildDatabaseUrlFromParts();

if (!databaseUrl) {
  throw new Error("DATABASE_URL or DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME is required.");
}

declare global {
  // eslint-disable-next-line no-var
  var __footballChainPgPool: Pool | undefined;
}

export const pgPool =
  global.__footballChainPgPool ??
  new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== "production") {
  global.__footballChainPgPool = pgPool;
}
