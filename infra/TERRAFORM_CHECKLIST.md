# Terraform v2 Checklist (Lambda + CloudFront + S3)

This replaces the original ECS Fargate + ALB design. That design was abandoned before ever
being deployed - there was no Dockerfile and no CI/CD pipeline to actually build/push an
image - and its always-on ALB + NAT Gateway + Fargate tasks didn't fit a small, low-traffic
daily-puzzle game. See the migration discussion for the full reasoning; this checklist
tracks the replacement.

## Target v2 (now)
- Public CloudFront URL (default domain, no custom domain yet)
- CloudFront -> [S3 for static assets] + [Lambda Function URL for the app] -> RDS PostgreSQL
- Zip-based Lambda (via OpenNext), not a container image - no ECR needed
- No NAT Gateway - Lambda reaches RDS privately within the VPC and the app makes no
  outbound calls to the public internet
- No SQS/DynamoDB - the app has no ISR/`revalidate` usage, so OpenNext's incremental
  cache/tag cache/revalidation queue are explicitly disabled (see `open-next.config.ts`
  at the repo root)

## Suggested layout

```
infra/
  environments/
    dev/       (backend.tf, providers.tf, versions.tf, variables.tf, terraform.tfvars.example, main.tf, outputs.tf)
    prod/      (same files)
    github-oidc/ # one-time bootstrap, applied separately from dev/prod - see below
  modules/
    network/            # VPC, subnets, IGW, optional NAT (off by default now)
    security/            # lambda SG, rds SG
    rds_postgres/         # unchanged from v1 - already right-sized
    lambda_app/           # the app: zip the OpenNext server function, Lambda + Function URL (AWS_IAM auth), secrets from Secrets Manager
    cloudfront_lambda/     # S3 bucket + OAC for static assets, Lambda-origin OAC, CloudFront distribution
    ops_lambda/            # VPC-attached Lambda running "migrate" and "rotate-puzzles" actions, invoked by GitHub Actions (no EventBridge - see note below)
    observability/         # Lambda log groups (app + ops), CloudWatch alarms, SNS topic
```

## Before running `terraform apply` for the first time

- [ ] Run `npx open-next build` from the repo root (produces `.open-next/`, which the
      `lambda_app` and `cloudfront_lambda` modules read from - see their
      `open_next_output_path`/`open_next_assets_path` variables, wired in
      `environments/*/main.tf`)
- [ ] Run `npm run build:ops-lambda` (produces `dist/`, which the `ops_lambda` module reads
      from - see its `ops_lambda_build_path` variable)
- [ ] Confirm the build ran on a machine/CI without a real `.env` present, or at least
      confirm `.next/standalone/.env` doesn't exist after the build - OpenNext's
      `buildCommand` override in `open-next.config.ts` strips it, but this is worth a
      final check the first time, since a leaked `.env` would mean real secrets sitting
      in the deployed Lambda artifact
- [ ] **One-time only**, before the first `deploy.yml`/`rotate-puzzles.yml` run: apply
      `environments/github-oidc/` manually with your own AWS credentials (`terraform init &&
      terraform apply` from that directory, after copying `terraform.tfvars.example`). Add
      the resulting `deploy_role_arn` and `invoke_ops_lambda_role_arn` outputs, plus your AWS
      region and the deployed ops Lambda's name (`${project}-${environment}-ops`, e.g.
      `football-chain-dev-ops`), as GitHub Actions repo variables: `AWS_DEPLOY_ROLE_ARN`,
      `AWS_INVOKE_OPS_LAMBDA_ROLE_ARN`, `AWS_REGION`, `OPS_LAMBDA_FUNCTION_NAME`. This is
      separate from - and a prerequisite for - the `dev`/`prod` applies below, since it's
      what lets GitHub Actions authenticate to AWS at all.
- [ ] `terraform init` in the target environment directory (needs network access to
      registry.terraform.io for the `aws`, `archive`, and `random` providers)
- [ ] Double-check the CloudFront managed policy IDs in `modules/cloudfront_lambda/main.tf`
      (CachingDisabled, CachingOptimized, AllViewerExceptHostHeader) and the Lambda-origin
      `aws_cloudfront_origin_access_control` resource shape against the current AWS
      provider docs - both were written from best available knowledge during this
      migration but not yet verified against a real `terraform plan`/`apply`
- [ ] `aws` CLI must be installed and authenticated on the machine running `terraform
      apply` - the `cloudfront_lambda` module uploads static assets via a `local-exec`
      `aws s3 sync` provisioner, not a Terraform-native resource

## File/module checklist

### `environments/*/versions.tf`
- [x] Pin Terraform version
- [x] Pin AWS, archive, and random provider versions

### `environments/*/providers.tf`
- [x] Configure AWS provider region
- [x] Configure default tags (project, env, owner)

### `environments/*/backend.tf`
- [x] S3 backend for state
- [x] DynamoDB state lock table

### `modules/network/main.tf`
- [x] VPC
- [x] 2+ public, private-app, private-db subnets
- [x] Internet Gateway
- [x] NAT Gateway - present but disabled (`enable_nat_gateway = false` in both tfvars);
      Lambda doesn't need it
- [x] Route tables and associations

### `modules/security/main.tf`
- [x] Lambda security group (egress only - nothing initiates ingress to it)
- [x] RDS security group (ingress 5432 from the Lambda SG only)

### `modules/rds_postgres/main.tf`
- [x] Unchanged from v1 - RDS PostgreSQL, encrypted, private, Secrets Manager secret,
      deletion protection in prod. Still single-AZ; revisit only if real availability
      requirements justify the cost.

### `modules/lambda_app/main.tf`
- [x] Zips the OpenNext server function build output
- [x] Lambda function, VPC-attached (private-app subnets, Lambda SG)
- [x] Function URL with `AWS_IAM` auth (not public - only CloudFront's OAC can invoke it)
- [x] `DATABASE_URL` sourced from the RDS module's existing Secrets Manager secret (fixes
      the v1 gap where that secret was created but never actually used)
- [x] `SESSION_SECRET` generated via the `random` provider and stored in its own Secrets
      Manager secret - never needs to exist in tfvars at all
- [ ] Execution role has no Secrets Manager read permission by design (Terraform resolves
      both secrets at `apply` time into plain env vars, it doesn't fetch them at runtime).
      Revisit if the app is changed to fetch secrets itself via the AWS SDK or the
      Parameters and Secrets Lambda Extension.

### `modules/cloudfront_lambda/main.tf`
- [x] CloudFront distribution
- [x] S3 origin (static assets, `_next/*` and `BUILD_ID`) with Origin Access Control
- [x] Lambda Function URL origin (everything else) with Origin Access Control
- [x] Viewer protocol policy: redirect-to-https
- [x] Cache policies tuned per behavior (CachingDisabled for the app + BUILD_ID,
      CachingOptimized for versioned `_next/*` assets)
- [x] Origin request policy forwarding required headers/cookies/query strings while
      excluding Host (required for Lambda Function URL origins behind OAC)
- [ ] WAF - optional later, not added
- [x] Output default CloudFront domain

### `modules/ops_lambda/main.tf`
- [x] VPC-attached Lambda (same private-RDS-access pattern as `lambda_app`: `DATABASE_URL`
      resolved from the `rds_postgres` module's Secrets Manager secret at apply time)
- [x] Runs `scripts/ops-lambda/handler.ts`'s two actions - `migrate` (applies
      `db/migrations/*.sql`, invoked by `deploy.yml` after every apply) and
      `rotate-puzzles` (promotes today's puzzle + tops up the 7-day buffer, invoked daily by
      `rotate-puzzles.yml`) - real daily-puzzle publish logic now exists
      (`scripts/puzzle-generation/rotate-puzzles.ts`), replacing the old placeholder
      discussed here previously.
- [x] **No EventBridge rule** - GitHub Actions (`.github/workflows/rotate-puzzles.yml`)
      is the sole scheduling trigger, invoking this Lambda directly via `aws lambda invoke`,
      so there's one place to see/change/rerun cron history instead of two. Trade-off:
      GitHub's `schedule:` cron can slip up to ~10-15 minutes under GitHub's own load - fine
      for a daily job with hours of slack either side.

### `modules/observability/main.tf`
- [x] CloudWatch log groups for both Lambda functions (app + ops), with retention
- [x] Alarms: app Lambda Errors, app Lambda Throttles, ops Lambda Errors, RDS CPUUtilization,
      RDS FreeStorageSpace
      (v1 had zero alarm resources despite this being checked off there - actually wired
      up this time)
- [x] SNS topic for alerts (prod's `alarm_email` in `terraform.tfvars.example` is still a
      placeholder - replace with a real address before relying on it)

### `environments/*/main.tf`
- [x] Instantiate all modules in dependency order
- [x] Wire outputs to inputs (subnets, SGs, ARNs, function URLs)

### `environments/*/outputs.tf`
- [x] `cloudfront_domain_name`
- [x] `lambda_function_url`
- [x] `rds_endpoint`
- [x] `static_assets_bucket`

## Security and reliability gates before go-live
- [x] No public RDS
- [x] DB credentials only in Secrets Manager (now actually wired to the Lambda, not just
      created and ignored)
- [x] SESSION_SECRET only in Secrets Manager, auto-generated
- [x] At-rest encryption enabled (RDS)
- [x] Health endpoint implemented (`/api/health`) - still a static `{ok:true}` stub with
      no DB/dependency check, same limitation as v1
- [ ] Backup restore tested in dev
- [ ] Alarms notify a real destination - prod's `alarm_email` is still a placeholder

## CI/CD (`.github/workflows/`)
- [x] `ci.yml` - typecheck + test on every PR/push, no AWS access needed
- [x] `deploy.yml` - on push to `main` (dev) or manual dispatch (dev or prod): build,
      `terraform apply`, then run pending migrations via the `ops_lambda`'s `migrate` action.
      Authenticates via the `github-oidc` bootstrap's deploy role - no stored AWS keys.
- [x] `rotate-puzzles.yml` - daily schedule + manual dispatch, invokes `ops_lambda`'s
      `rotate-puzzles` action via the bootstrap's narrower invoke-only role
- [ ] Both workflows will fail at the AWS-auth step until the one-time `github-oidc`
      bootstrap (see above) has actually been applied and its repo variables set - expected
      until then, not a bug

## Explicitly deferred (fine at this scale, revisit later)
- [ ] Custom domain + ACM certificate - CloudFront's default cert is fine for now
- [ ] RDS Multi-AZ - single-AZ is fine until real availability requirements justify it
- [ ] RDS Proxy - add when Lambda concurrency actually causes connection pressure, not
      preemptively (the app's `pg.Pool` max was already reduced from 10 to 3 in
      anticipation of this - see `src/backend/repositories/postgres/db.ts`)
