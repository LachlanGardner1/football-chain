# Football Chain Development Roadmap

## Purpose
This document tracks the intended development path for the Football Chain app and is updated as features are completed.

## Current status
- Core validator logic is implemented and tested.
- The browser puzzle UI supports interactive step-by-step play.
- The app can load daily puzzle data and catalog data locally.
- The puzzle now has a clear solved-state experience, replay/reset flow, and stronger validation feedback.
- The next phase is gameplay and UI expansion before production hosting.
- Basic documentation and context notes exist for future sessions.

## Next development steps

### 1. Complete the puzzle finish experience
- Add a clear win state when the puzzle is solved.
- Show a success message and a polished completion summary.
- Hide or disable the active input flow after solving.
- Add a restart or play-again action.

### 2. Improve puzzle reset and replay flow
- Add a reset button to clear the current chain.
- Restore the puzzle to the initial ready state cleanly.
- Allow replaying the same puzzle without refreshing the page.

### 3. Polish the gameplay UX
- Improve feedback for valid and invalid submissions.
- Make the current step and expected node type clearer.
- Add subtle visual cues for solved, active, and invalid states.

### 4. Expand backend/game services
- Add richer daily puzzle metadata if needed.
- Consider a service for puzzle progression and scoring.
- Keep validator behavior aligned with the current UI flow.

### 5. Add richer data sourcing
- Source additional football data from a public football database or API.
- Expand the catalog beyond the current local seed set.
- Add import and refresh tooling for players, clubs, and relationships.
- Keep data quality and attribution in mind for future gameplay modes.

### 6. Prepare for future game modes
- Add support for additional puzzle modes beyond the basic daily challenge.
- Keep the validator and UI abstractions reusable.

### 7. Prepare production infrastructure
- Set up a production-grade hosting plan on AWS.
- Decide on the deployment target, such as ECS, App Runner, Amplify, or EC2.
- Provision managed PostgreSQL for production data.
- Add environment variables and secrets management.
- Configure domain registration, DNS, and HTTPS certificates.

### 8. Add observability and reliability
- Add structured logging and request tracing.
- Set up monitoring and alerting for uptime, latency, and errors.
- Add health checks for the web app and database.
- Create backup and restore procedures for PostgreSQL.

### 9. Harden security and compliance
- Secure API routes and admin endpoints.
- Add authentication and authorisation where needed.
- Review data handling for privacy and user content.
- Add rate limiting and abuse protection.

### 10. Improve content and data operations
- Add admin tooling for managing puzzles, players, clubs, and graph data.
- Introduce a content workflow for publishing daily puzzles.
- Add data validation and import tooling for future dataset updates.

### 11. Scale for real users
- Add caching where useful for catalog and daily puzzle reads.
- Consider queueing or background jobs for heavy data operations.
- Review performance under real traffic and optimise as needed.

## Implementation notes
- Keep the validator as the source of truth for valid/invalid chain progression.
- Keep UI state driven by validator responses.
- Prefer small, testable changes over larger rewrites.

## Update log
- [x] Validator logic implemented and tested
- [x] Step-by-step UI flow implemented
- [x] Context and documentation notes created
- [x] Win-state completion experience
- [x] Reset/replay flow
- [ ] Gameplay polish
- [ ] Future mode expansion
- [ ] Production infrastructure on AWS
- [ ] Observability and reliability
- [ ] Security hardening
- [ ] Content and data operations tooling
- [ ] Traffic scaling and performance tuning
