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
  # Both modules below derive the same Lambda function name from project/environment,
  # so this is computed here rather than threaded through a module output - that keeps
  # observability (which needs the name for its alarms) from having to depend on
  # lambda_app (which needs observability's log group to exist first). See the comment
  # on the lambda_app module block below for the resulting dependency order.
  lambda_function_name  = "${var.project}-${var.environment}-app"
  open_next_output_root = "${path.root}/../../../.open-next"
}

module "observability" {
  source = "../../modules/observability"

  project              = var.project
  environment          = var.environment
  log_retention_days   = var.log_retention_days
  alarm_email          = var.alarm_email
  lambda_function_name = local.lambda_function_name
  db_instance_id       = module.rds.db_instance_id
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

module "scheduler" {
  source = "../../modules/scheduler"

  project             = var.project
  environment         = var.environment
  schedule_expression = var.daily_schedule_expression
  enabled             = var.enable_daily_scheduler
}
