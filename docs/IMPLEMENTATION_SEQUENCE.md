# Implementation sequence (v1 daily mode)

## Week 1: data and graph core

1. Apply migrations.
2. Build import script for players, clubs, player_clubs, data_versions.
3. Implement graph loader from active dataset version.
4. Add bidirectional BFS tests with known fixtures.

## Week 2: puzzle and API

1. Implement daily puzzle publish job.
2. Implement `GET /api/daily` against DB.
3. Implement `POST /api/validate-chain` with strict alternation and edge checks.
4. Implement `POST /api/complete` and streak updates.
5. Implement `GET /api/me/stats`.

## Week 3: infra and deploy

1. Create Terraform modules from checklist.
2. Deploy app + DB to dev.
3. Put CloudFront in front of ALB.
4. Configure alarms and logs.
5. Run load smoke tests and publish dry runs.

## Week 4: polish and launch

1. Add score tiers and share output text.
2. Add rate limiting for write endpoints.
3. Harden input validation and error handling.
4. Run a 7-day shadow publish verification.
5. Launch daily mode.
