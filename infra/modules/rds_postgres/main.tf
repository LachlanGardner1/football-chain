locals {
  name_prefix = "${var.project}-${var.environment}"
}

resource "aws_db_subnet_group" "this" {
  name       = "${local.name_prefix}-db-subnet-group"
  subnet_ids = var.private_db_subnet_ids
}

resource "aws_db_parameter_group" "this" {
  name   = "${local.name_prefix}-pg-params"
  family = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

resource "aws_secretsmanager_secret" "db" {
  name = "${local.name_prefix}/db"
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = var.db_username
    password = var.db_password
    dbname   = var.db_name
  })
}

resource "aws_db_instance" "this" {
  identifier                  = "${local.name_prefix}-postgres"
  engine                      = "postgres"
  engine_version              = "16.3"
  instance_class              = var.db_instance_class
  allocated_storage           = var.allocated_storage
  storage_encrypted           = true
  db_name                     = var.db_name
  username                    = var.db_username
  password                    = var.db_password
  db_subnet_group_name        = aws_db_subnet_group.this.name
  vpc_security_group_ids      = [var.rds_security_group_id]
  backup_retention_period     = var.backup_retention_period
  deletion_protection         = var.deletion_protection
  publicly_accessible         = false
  auto_minor_version_upgrade  = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${local.name_prefix}-final-snapshot"
  parameter_group_name        = aws_db_parameter_group.this.name
  performance_insights_enabled = true
}
