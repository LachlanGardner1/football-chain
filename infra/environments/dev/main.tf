locals {
  lambda_function_name     = "${var.project}-${var.environment}-app"
  ops_lambda_function_name = "${var.project}-${var.environment}-ops"
  open_next_output_root    = "${path.root}/../../../.open-next"
  ops_lambda_build_path    = "${path.root}/../../../dist"
}

# Dev's Postgres is Neon (https://neon.tech), not RDS - this AWS account doesn't qualify for
# AWS RDS Free Tier (tied to the account's age, not RDS usage), and Neon's free tier costs
# nothing indefinitely while comfortably covering this app's actual data size (~23MB against a
# 500MB limit, checked directly). This is why dev has no network/security/rds modules at all:
# nothing here needs a VPC once the database isn't RDS - see infra/modules/lambda_app and
# ops_lambda's `use_vpc`/`use_external_database_url` locals, which fall back to no VPC
# attachment whenever there's no RDS-shaped db_secret_arn/db_endpoint supplied.
#
# One-time manual setup (can't be scripted from here - needs your own Neon account):
#   1. Create a free project at neon.tech (no card required).
#   2. From the dashboard, copy the *pooled* connection string, not the direct one - Lambda
#      opens a fresh connection per invocation, so it needs Neon's PgBouncer-backed pooled
#      endpoint or it'll exhaust Postgres' connection limit under any real concurrency.
#   3. Run `DATABASE_URL="<pooled connection string>" npm run db:migrate` (then `db:seed` and
#      `db:import-transfermarkt`) once from your machine, so dev starts populated rather than
#      empty.
#   4. Supply that same string as `neon_database_url` via terraform.tfvars (gitignored - see
#      terraform.tfvars.example) or a TF_VAR_neon_database_url env var. Never commit the real
#      value.
resource "aws_secretsmanager_secret" "neon_db" {
  name = "${var.project}-${var.environment}/neon-database-url"
}

resource "aws_secretsmanager_secret_version" "neon_db" {
  secret_id     = aws_secretsmanager_secret.neon_db.id
  secret_string = var.neon_database_url
}

module "observability" {
  source = "../../modules/observability"

  project                  = var.project
  environment              = var.environment
  log_retention_days       = var.log_retention_days
  alarm_email              = var.alarm_email
  lambda_function_name     = local.lambda_function_name
  ops_lambda_function_name = local.ops_lambda_function_name
  # Neon has no AWS/RDS CloudWatch metrics to alarm on - see infra/modules/observability.
  enable_rds_alarms = false
}

module "lambda_app" {
  source = "../../modules/lambda_app"

  project                          = var.project
  environment                      = var.environment
  open_next_output_path            = "${local.open_next_output_root}/server-functions/default"
  external_database_url_secret_arn = aws_secretsmanager_secret.neon_db.arn
  log_group_name                   = module.observability.log_group_name
  memory_size                      = var.lambda_memory_size
  timeout                          = var.lambda_timeout

  # Ensures the CloudWatch log group (created by observability, with retention set) exists
  # before the function does, so Lambda doesn't auto-create a conflicting default one.
  depends_on = [module.observability]
}

module "cloudfront" {
  source = "../../modules/cloudfront_lambda"

  project                    = var.project
  environment                = var.environment
  lambda_function_name       = module.lambda_app.function_name
  lambda_function_url_domain = module.lambda_app.function_url_domain
  open_next_assets_path      = "${local.open_next_output_root}/assets"
}

module "ops_lambda" {
  source = "../../modules/ops_lambda"

  project                          = var.project
  environment                      = var.environment
  ops_lambda_build_path            = local.ops_lambda_build_path
  external_database_url_secret_arn = aws_secretsmanager_secret.neon_db.arn
  log_group_name                   = module.observability.ops_log_group_name

  # Same reasoning as lambda_app's depends_on: the CloudWatch log group needs to exist
  # (with retention set) before the function does.
  depends_on = [module.observability]
}
