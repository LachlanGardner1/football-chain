module "network" {
  source = "../../modules/network"

  project                  = var.project
  environment              = var.environment
  vpc_cidr                 = var.vpc_cidr
  availability_zones       = var.availability_zones
  public_subnet_cidrs      = var.public_subnet_cidrs
  private_app_subnet_cidrs = var.private_app_subnet_cidrs
  private_db_subnet_cidrs  = var.private_db_subnet_cidrs
  enable_nat_gateway       = var.enable_nat_gateway
}

module "security" {
  source = "../../modules/security"

  project     = var.project
  environment = var.environment
  vpc_id      = module.network.vpc_id
}

module "rds" {
  source = "../../modules/rds_postgres"

  project                 = var.project
  environment             = var.environment
  db_name                 = var.db_name
  db_username             = var.db_username
  db_password             = var.db_password
  db_instance_class       = var.db_instance_class
  allocated_storage       = var.db_allocated_storage
  backup_retention_period = var.db_backup_retention_days
  deletion_protection     = var.db_deletion_protection
  private_db_subnet_ids   = module.network.private_db_subnet_ids
  rds_security_group_id   = module.security.rds_security_group_id
}

locals {
  # Both modules below derive the same Lambda function names from project/environment, so
  # they're computed here rather than threaded through module outputs - that keeps
  # observability (which needs the names for its alarms) from having to depend on lambda_app
  # / ops_lambda (which each need observability's log groups to exist first). See the
  # comments on those module blocks below for the resulting dependency order.
  lambda_function_name     = "${var.project}-${var.environment}-app"
  ops_lambda_function_name = "${var.project}-${var.environment}-ops"
  open_next_output_root    = "${path.root}/../../../.open-next"
  ops_lambda_build_path    = "${path.root}/../../../dist"
}

module "observability" {
  source = "../../modules/observability"

  project                  = var.project
  environment              = var.environment
  log_retention_days       = var.log_retention_days
  alarm_email              = var.alarm_email
  lambda_function_name     = local.lambda_function_name
  ops_lambda_function_name = local.ops_lambda_function_name
  db_instance_id           = module.rds.db_instance_id
}

module "lambda_app" {
  source = "../../modules/lambda_app"

  project                  = var.project
  environment              = var.environment
  open_next_output_path    = "${local.open_next_output_root}/server-functions/default"
  private_app_subnet_ids   = module.network.private_app_subnet_ids
  lambda_security_group_id = module.security.lambda_security_group_id
  db_secret_arn            = module.rds.secret_arn
  db_endpoint              = module.rds.endpoint
  db_name                  = var.db_name
  log_group_name           = module.observability.log_group_name
  memory_size              = var.lambda_memory_size
  timeout                  = var.lambda_timeout

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

  project                  = var.project
  environment              = var.environment
  ops_lambda_build_path    = local.ops_lambda_build_path
  private_app_subnet_ids   = module.network.private_app_subnet_ids
  lambda_security_group_id = module.security.lambda_security_group_id
  db_secret_arn            = module.rds.secret_arn
  db_endpoint              = module.rds.endpoint
  db_name                  = var.db_name
  log_group_name           = module.observability.ops_log_group_name

  # Same reasoning as lambda_app's depends_on: the CloudWatch log group needs to exist
  # (with retention set) before the function does.
  depends_on = [module.observability]
}
