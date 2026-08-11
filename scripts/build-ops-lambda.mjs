// Builds the ops Lambda deployment bundle: esbuild-bundles scripts/ops-lambda/handler.ts to
// dist/ops-lambda/index.js, then copies db/migrations alongside it as dist/db/migrations.
//
// The copy matters because scripts/migrate.ts's `runMigrations` reads *.sql files off disk
// at runtime (readdir/readFile) rather than having them bundled - esbuild only bundles JS/TS,
// so the migrations directory has to be staged separately. It's placed one level up from
// dist/ops-lambda/ (i.e. dist/db/migrations) so migrate.ts's existing
// `path.resolve(scriptDir, "../db/migrations")` resolves it identically to how it resolves
// the real db/migrations/ one level up from scripts/ in the CLI case - same relative shape,
// different root.
//
// infra/modules/ops_lambda zips the whole dist/ directory, with the Lambda handler set to
// "ops-lambda/index.handler".

import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "dist");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, "ops-lambda"), { recursive: true });

// The repo root's package.json declares "type": "module". Without a type declaration of its
// own, dist/ would inherit that via Node's upward package.json search - which silently turns
// this esbuild CJS bundle's `module.exports`/`require` into dead code under Node's ESM loader
// (no error, just an empty exports object). Pinning it here makes the bundle unambiguously
// CommonJS both for local smoke-testing and as defense-in-depth in the deployed Lambda zip
// (which won't have any package.json of its own, so would default to CommonJS anyway).
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2));

await build({
  entryPoints: [path.join(repoRoot, "scripts/ops-lambda/handler.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(outDir, "ops-lambda/index.js"),
  external: ["pg-native"],
});

cpSync(path.join(repoRoot, "db/migrations"), path.join(outDir, "db/migrations"), { recursive: true });

console.log("Built dist/ops-lambda/index.js (+ dist/db/migrations alongside it)");
