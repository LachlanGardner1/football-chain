# Backend skeleton notes

This skeleton is intentionally minimal so you can replace repository stubs with Postgres-backed implementations.

## Implement next

1. Replace repository stubs in `src/backend/wiring/container.ts` with real implementations.
2. Add a Postgres client and transaction helper.
3. Load graph edges from `player_clubs` for active `data_versions` row.
4. Rebuild graph at startup and on dataset version switch.
5. Add request validation for API routes.
6. Add auth and user identity resolution.
7. Add integration tests for daily fetch, chain validation, and result upsert.

## Suggested repository implementations

- `PgDailyPuzzleRepository`
- `PgGameResultRepository`
- `PgGraphRepository`

## Suggested caching v1

- In-memory graph adjacency map
- In-memory shortest path memo:
  - key: `startPlayerId:targetPlayerId:datasetVersionId`
  - value: path node list
  - reset cache when dataset version changes
