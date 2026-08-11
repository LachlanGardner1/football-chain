# Phase 2 Backlog

This backlog breaks the next phase of work into smaller, testable stories so progress can be tracked one item at a time.

## Theme 1 — Gameplay depth

### Story 1.1 — Add a score model for each puzzle
- [ ] Define scoring rules for valid chains
- [ ] Show the score after each submission
- [ ] Show the best score achieved for the current puzzle

### Story 1.2 — Add a daily puzzle streak concept
- [x] Define how a streak is counted
- [x] Track whether the daily puzzle was solved today
- [x] Show current streak and best streak in the UI
** test this more thoroughly

### Story 1.3 — Create longer daily puzzles with strict constraints
- [ ] Define longer chain requirements (for example, 4-5 players in the chain)
- [ ] Implement no-repeat-player and no-repeat-club constraints across generation, validation, and UI
- [ ] Add a graph-search pass that finds a valid traversal path without reusing players or clubs
- [ ] Ensure generated puzzles remain solvable and reject or regenerate unsatisfiable candidates
- [ ] Update the daily puzzle seed data and generation pipeline for these longer puzzles

### Story 1.4 — Add a second puzzle mode
- [ ] Define a random or themed puzzle mode
- [ ] Create a simple route or toggle for switching modes
- [ ] Make the validator and UI work for both modes

## Theme 2 — Better puzzle UX

### Story 2.1 — Improve step feedback
- [ ] Make the current expected node type more obvious
- [ ] Improve visual state for valid, invalid, and repeat submissions
- [ ] Add clearer success and failure messaging

### Story 2.2 — Make the chain path more visual
- [ ] Show the built chain in a more readable format
- [ ] Highlight the current step in the chain
- [ ] Add a small visual summary for the completed path

### Story 2.3 — Improve the suggestion experience
- [ ] Improve keyboard navigation for suggestions
- [ ] Make repeated suggestions feel clearer
- [ ] Add better empty-state or no-match messaging

## Theme 3 — Progression and stats foundation

### Story 3.1 — Add local-only progress persistence
- [ ] Save daily completion state in browser storage
- [ ] Restore that state when the app reloads
- [ ] Show local best score and streak information

### Story 3.2 — Add backend user stats tables
- [ ] Create a users table
- [ ] Create a game_results table
- [ ] Store puzzle completion results from the app

### Story 3.3 — Add stats API endpoints
- [ ] Create an endpoint to fetch user stats
- [ ] Create an endpoint to save a completed puzzle result
- [ ] Return streak, score, and completion history data

## Theme 4 — Data expansion

### Story 4.1 — Add a public football data source
- [x] Choose a public football data provider or API — [dcaribou/transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets), CC0-1.0
- [x] Define the data schema we need for players, clubs, and transfers — mapped onto the existing `players`/`clubs`/`player_clubs` tables, no schema change needed
- [x] Create an import script for the first batch of data — `scripts/data-import/import-transfermarkt.ts` (`npm run db:import-transfermarkt`)

### Story 4.2 — Expand the catalog from imported data
- [x] Import a larger player/club catalog — 6,066 players / 774 clubs / ~23.8k edges, filtered to players with peak market value >= EUR 8M or >= 20 international caps
- [x] Add support for more puzzle generation options — `scripts/puzzle-generation/rotate-puzzles.ts` (`npm run puzzles:rotate`) randomly samples 3-5 anchor players from the full catalog, verifies solvability + difficulty band via the solver, dedupes against the last 60 days of puzzles, and tops up a rolling 7-day buffer of `DRAFT` puzzles; a daily promote step flips today's `DRAFT` puzzle to `PUBLISHED`. Runs both as a local CLI script and as the ops Lambda's `rotate-puzzles` action, triggered daily by `.github/workflows/rotate-puzzles.yml`.
- [x] Validate imported data for duplicates and broken links — found and removed 3 duplicate club rows (`Ajax` / `AS Roma` / `Bayer Leverkusen` vs. the imported dataset's official names); all 5 previously dead-end clubs now have real edges

**Resolved**: the solver-scaling issue previously noted here (`findShortestAnchorChain` blowing up on high-degree "hub" clubs like Real Madrid/Man City — a 3-anchor Haaland/De Bruyne/Salah case ran for minutes at 1GB+ memory) was fixed by guiding the search with precomputed BFS hop-distances from each anchor; the same case now solves in 22ms (see `scripts/puzzle-generation/solver.ts` and its regression test). The rotation pipeline above builds directly on that fix.

## Theme 5 — Release readiness later

### Story 5.1 — Add a simple deployment target
- [x] Choose a hosting option — Lambda (via OpenNext) + CloudFront + S3, RDS Postgres; see `infra/TERRAFORM_CHECKLIST.md`
- [x] Prepare environment variables for production — `DATABASE_URL`/`SESSION_SECRET` resolved from Secrets Manager into Lambda env vars by Terraform at apply time
- [ ] Deploy the current app to a test environment — Terraform, the ops Lambda (migrations + puzzle rotation), and the GitHub Actions CI/CD pipeline (`.github/workflows/`) are all written and passing locally, but nothing has actually been applied to AWS yet. Needs the one-time `github-oidc` bootstrap applied first (see `infra/TERRAFORM_CHECKLIST.md`), then a real `deploy.yml` run.

### Story 5.2 — Add observability basics
- [ ] Add health endpoint checks
- [ ] Add basic logging for important actions
- [ ] Add simple monitoring for app uptime

## Progress notes
- [ ] Story 1.1
- [x] Story 1.2
- [ ] Story 1.3
- [ ] Story 2.1
- [ ] Story 2.2
- [ ] Story 2.3
- [ ] Story 3.1
- [ ] Story 3.2
- [ ] Story 3.3
- [x] Story 4.1
- [x] Story 4.2
- [ ] Story 5.1 (pipeline built, not yet applied to AWS)
- [ ] Story 5.2
