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
  modules/
    network/            # VPC, subnets, IGW, optional NAT (off by default now)
    security/            # lambda SG, rds SG
    rds_postgres/         # unchanged from v1 - already right-sized
    lambda_app/           # the app: zip the OpenNext server function, Lambda + Function URL (AWS_IAM auth), secrets from Secrets Manager
    cloudfront_lambda/     # S3 bucket + OAC for static assets, Lambda-origin OAC, CloudFront distribution
    scheduler/             # EventBridge daily cron -> placeholder Lambda (see note below)
    observability/         # Lambda log group, CloudWatch alarms, SNS topic
```

## Before running `terraform apply` for the first time

- [ ] Run `npx open-next build` from the repo root (produces `.open-next/`, which the
      `lambda_app` and `cloudfront_lambda` modules read from - see their
      `open_next_output_path`/`open_next_assets_path` variables, wired in
      `environments/*/main.tf`)
- [ ] Confirm the build ran on a machine/CI without a real `.env` present, or at least
      confirm `.next/standalone/.env` doesn't exist after the build - OpenNext's
      `buildCommand` override in `open-next.config.ts` strips it, but this is worth a
      final check the first time, since a leaked `.env` would mean real secrets sitting
      in the deployed Lambda artifact
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

### `modules/scheduler/main.tf`
- [x] EventBridge rule (daily publish time)
- [x] Target = placeholder Lambda function (logs and returns - **no actual daily-puzzle
      publish logic exists in the app yet**; this was discovered during the migration
      review, not something the migration removed. Building the real publish job (how the
      next day's puzzle gets chosen/activated) is separate future work.)

### `modules/observability/main.tf`
- [x] CloudWatch log group for the Lambda function, with retention
- [x] Alarms: Lambda Errors, Lambda Throttles, RDS CPUUtilization, RDS FreeStorageSpace
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

## Explicitly deferred (fine at this scale, revisit later)
- [ ] Custom domain + ACM certificate - CloudFront's default cert is fine for now
- [ ] RDS Multi-AZ - single-AZ is fine until real availability requirements justify it
- [ ] RDS Proxy - add when Lambda concurrency actually causes connection pressure, not
      preemptively (the app's `pg.Pool` max was already reduced from 10 to 3 in
      anticipation of this - see `src/backend/repositories/postgres/db.ts`)
- [ ] CI/CD pipeline - there still isn't one. `terraform apply` currently expects
      `npx open-next build` to have been run locally first. Automating that (GitHub
      Actions or similar) is separate future work.
- [ ] Daily puzzle publish logic - see the scheduler note above
