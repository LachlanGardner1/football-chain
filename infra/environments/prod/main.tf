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
  app_port    = var.app_port
}

module "ecr" {
  source = "../../modules/ecr"

  project     = var.project
  environment = var.environment
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

module "alb" {
  source = "../../modules/alb"

  project               = var.project
  environment           = var.environment
  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  alb_security_group_id = module.security.alb_security_group_id
  app_port              = var.app_port
  health_check_path     = var.health_check_path
}

module "observability" {
  source = "../../modules/observability"

  project            = var.project
  environment        = var.environment
  log_retention_days = var.log_retention_days
  alarm_email        = var.alarm_email
}

locals {
  app_image    = "${module.ecr.repository_url}:${var.app_image_tag}"
  database_url = "postgres://${var.db_username}:${var.db_password}@${module.rds.endpoint}:5432/${var.db_name}"
}

module "ecs" {
  source = "../../modules/ecs_service"

  project                   = var.project
  environment               = var.environment
  app_image                 = local.app_image
  app_port                  = var.app_port
  cpu                       = var.ecs_cpu
  memory                    = var.ecs_memory
  desired_count             = var.ecs_desired_count
  private_app_subnet_ids    = module.network.private_app_subnet_ids
  ecs_security_group_id     = module.security.ecs_security_group_id
  target_group_arn          = module.alb.target_group_arn
  log_group_name            = module.observability.log_group_name
  environment_variables     = { DATABASE_URL = local.database_url }
  secret_environment_variables = {}
}

module "cloudfront" {
  source = "../../modules/cloudfront_alb"

  project      = var.project
  environment  = var.environment
  alb_dns_name = module.alb.alb_dns_name
}

module "scheduler" {
  source = "../../modules/scheduler"

  project             = var.project
  environment         = var.environment
  schedule_expression = var.daily_schedule_expression
  cluster_arn         = module.ecs.cluster_arn
  task_definition_arn = module.ecs.task_definition_arn
  subnet_ids          = module.network.private_app_subnet_ids
  security_group_ids  = [module.security.ecs_security_group_id]
  task_role_arn       = module.ecs.task_role_arn
  enabled             = var.enable_daily_scheduler
}
