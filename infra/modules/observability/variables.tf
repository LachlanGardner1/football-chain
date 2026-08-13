variable "project" { type = string }
variable "environment" { type = string }
variable "log_retention_days" { type = number }
variable "alarm_email" { type = string }
variable "lambda_function_name" { type = string }
variable "ops_lambda_function_name" { type = string }

# RDS alarms only make sense when the database is actually RDS - an environment on an
# externally-hosted database (e.g. Neon) has no AWS/RDS CloudWatch metrics to alarm on at all.
variable "enable_rds_alarms" {
  type    = bool
  default = true
}
variable "db_instance_id" {
  type    = string
  default = null
}
