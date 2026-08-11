# Football Chain Context Memory

## Product goal
- This app is a daily football transfer-chain puzzle.
- The gameplay is step-by-step: the user builds a chain of PLAYER -> CLUB -> PLAYER -> CLUB ... links.
- The validator should guide the user with clear messages, but it should not reject a valid intermediate step just because the chain is not complete yet.

## Current gameplay rules
- Each daily puzzle names 3-5 "anchor" players (`daily_puzzle_players`, an unordered set - no fixed start/target). The player chooses which anchor to start on, which to end on, and in what order to visit the rest. This replaced an earlier fixed start-player -> ordered-required-sequence -> target-player design, which effectively pre-solved the route for the player.
- The first submitted node must be one of the puzzle's anchor players (any of them, not a specific one).
- The chain must alternate between players and clubs.
- A player followed by anything other than a club is invalid.
- A club followed by anything other than a player is invalid.
- A link between a player and a club is valid only if the graph contains that relationship.
- The chain may pass through non-anchor players too (a real intermediate transfer), not just the named anchors - the graph is not restricted to anchor-to-anchor edges.
- The puzzle is solved once the chain ends on any anchor player and every anchor has appeared somewhere in the chain. Order does not matter.
- Intermediate valid steps should return a non-error result such as "Link looks good. Keep going."

## Puzzle generation
- `scripts/puzzle-generation/solver.ts` (`findShortestAnchorChain`) verifies a candidate anchor set is actually solvable and computes the true shortest connecting chain (tries every start/end ordering of the anchors with a branch-and-bound search, not just the first path found) - `optimal_length` comes from this, not a hand-typed guess.
- `scripts/seed-dev.ts` calls this solver when seeding puzzles and throws if a candidate anchor set turns out unsolvable, instead of trusting hand-picked players.

## Important implementation notes
- The validator lives in src/backend/services/game/chain-validation.service.ts.
- The browser UI uses the validator through the API route at src/app/api/validate-chain/route.ts.
- The UI flow currently expects the validator to return a non-error response for valid intermediate steps while still allowing the user to continue.
- The seed data and graph repository populate the relationships used by the validator.

## Regression tests
- Validator tests live in src/backend/services/game/chain-validation.service.test.ts.
- These tests cover success cases, failure cases, and boundary conditions such as empty chains and invalid alternation.

## Local development
- Run the validator tests with: npm run test:validation
- Run the app locally with: npm run dev
