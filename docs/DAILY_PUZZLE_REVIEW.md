# Daily Puzzle & Backlog Review

Review of the daily puzzle game logic and `PHASE_2_BACKLOG.md`, conducted 2026-08-10.

## Part A — Concrete bugs found in the daily puzzle

1. ~~**5 of the 19 seeded clubs are dead ends.**~~ **Fixed.** Resolved by importing [dcaribou/transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets) (`scripts/data-import/import-transfermarkt.ts`, `npm run db:import-transfermarkt`) — Borussia Dortmund, Inter Milan, Ajax, AS Roma, and Bayer Leverkusen all now have real player edges. The import also surfaced and fixed 3 duplicate club rows (the hand-seeded "Ajax"/"AS Roma"/"Bayer Leverkusen" vs. the dataset's official names "Ajax Amsterdam"/"Associazione Sportiva Roma"/"Bayer 04 Leverkusen") — see `docs/PHASE_2_BACKLOG.md` Theme 4 for the full writeup, including a follow-up finding that the puzzle solver (`scripts/puzzle-generation/solver.ts`) doesn't scale well to the larger graph for anchor sets that are far apart.
2. **The puzzle-date fallback is silent.** `PgDailyPuzzleRepository.getPublishedPuzzleByDate` first tries an exact date match, and if none exists, falls back to *whatever the most recently published puzzle is, regardless of date* — with nothing telling the caller a fallback happened. Pick a date with no puzzle (including a future date) via the UI's date picker and you silently get served an unrelated puzzle with no explanation.
3. **Two streak counters that can silently disagree.** `streakStorage.ts`/`streakCalculator.ts` compute a streak entirely client-side from `localStorage`, keyed to a random `player-<timestamp>` id with no relation to the server session. Separately, `/api/complete` → `refresh_user_streak()` computes a *second*, independent streak server-side, keyed to the real session identity and using the server's own `CURRENT_DATE`. Both are shown in the UI simultaneously with no reconciliation.
4. **Puzzle generation didn't actually verify what it claimed to.** The old DFS in `seed-dev.ts` returned the length of *the first* no-repeat path it happened to find in adjacency-insertion order — not the shortest path, not a uniqueness check. The `required_player_ids` shown to the player as the intended route were hand-typed constants never verified against the graph at all. (Addressed by the anchor-chain redesign and new solver, see below.)
5. **`resolveProgressScore` in `scoring.ts` is dead code** (ignores both its parameters), and `efficiencyBonus` in the score breakdown actually holds the *total* score, not an efficiency component.

## Part B — The bigger playability question: the puzzle revealed its own answer

Every required intermediate player was shown as a numbered chip before the player made a single move, and a "Still needed" callout kept re-listing exactly who was left outstanding at every step. With a small player pool, once you know the checkpoints and their fixed order, each hop is "which of this player's known clubs leads to the next named checkpoint" — a small lookup, not real pathfinding.

**Resolution:** the puzzle now gives 3-5 named players up front, but the player chooses their own start, end, and the order in which the remaining anchors are visited — restoring genuine route-finding even though the player names are still disclosed.

## Part C — `PHASE_2_BACKLOG.md`: solid direction, but the checkboxes were stale

Several stories were shown as 0% done despite being fully built already:
- **Story 1.1 (scoring)** — fully implemented, live in the UI. Only gap: persisting "best score for this puzzle."
- **Story 3.1 (local persistence)** — the same code as the already-checked Story 1.2.
- **Stories 3.2/3.3 (backend stats tables + API)** — fully built and live.
- **Story 1.3 (longer puzzles)** — 3 of 5 bullets already existed; the real gap was "reject/regenerate unsatisfiable candidates" (addressed by the new solver).
- **Story 1.4 (second mode)** — undersold the cost: `daily_puzzles.puzzle_date` has a hard `UNIQUE` constraint, needs a schema change, not just a UI toggle.

**Recommendation:** re-audit backlog checkboxes against the code before sprint planning. Fold Theme 3 into Theme 1. Sequence Story 1.3's generation pipeline with Theme 4 (data expansion) together — neither is separately meaningful without the other.

## Actions taken from this review

1. Redesigned the required-player disclosure into the any-order anchor-player model described above (Part B) — the highest-leverage playability change identified.
2. Added a real solvability + shortest-route solver to puzzle generation (`scripts/puzzle-generation/solver.ts`), replacing the unverified first-path-found DFS.
3. Dead-end clubs, the streak reconciliation, and content/data expansion remain open — deferred per product priority, not forgotten.
