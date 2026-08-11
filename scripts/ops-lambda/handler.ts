// Entry point for the ops Lambda (infra/modules/ops_lambda) - the one thing besides the app
// Lambda itself that can reach RDS, since it's private to the VPC. GitHub Actions decides
// *when* this runs (see .github/workflows/deploy.yml and rotate-puzzles.yml) and invokes it
// with `aws lambda invoke --payload '{"action":"..."}'`; this file just dispatches.
//
// Bundled to a single CJS file via `npm run build:ops-lambda` (esbuild) - see
// infra/modules/ops_lambda/main.tf for how that bundle gets zipped and deployed.

import pg from "pg";

import { runMigrations } from "../migrate";
import { runDailyRotation } from "../puzzle-generation/rotate-puzzles";

const { Pool } = pg;

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required.");
    }
    // Lambda execution environments are frozen between invocations and reused for the next
    // one while warm, so a module-level pool (created once, never explicitly closed) is the
    // right lifetime here - same pattern as src/backend/repositories/postgres/db.ts.
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
  }
  return pool;
}

export type OpsLambdaEvent = { action: "migrate" | "rotate-puzzles" };
export type OpsLambdaResult = { ok: boolean; action: string; result?: unknown; error?: string };

// Invoked directly (`aws lambda invoke`), not through API Gateway/a Function URL - so this
// returns a plain result object rather than an API-Gateway-style {statusCode, body} envelope.
// GitHub Actions checks both the invoke's own FunctionError (an unhandled throw) and this
// object's `ok` field (a handled failure, e.g. an unknown action) - see
// .github/workflows/deploy.yml and rotate-puzzles.yml.
export async function handler(event: OpsLambdaEvent): Promise<OpsLambdaResult> {
  console.log("ops-lambda invoked", JSON.stringify(event));

  switch (event.action) {
    case "migrate": {
      await runMigrations(getPool());
      return { ok: true, action: "migrate" };
    }
    case "rotate-puzzles": {
      const result = await runDailyRotation(getPool());
      return { ok: true, action: "rotate-puzzles", result };
    }
    default: {
      const unknownAction: string = (event as { action?: string })?.action ?? "(missing)";
      return { ok: false, action: unknownAction, error: `Unknown action: ${unknownAction}` };
    }
  }
}
