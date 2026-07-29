variable "project" { type = string }
variable "environment" { type = string }
variable "aws_region" { type = string }
variable "availability_zones" { type = list(string) }

variable "vpc_cidr" { type = string }
variable "public_subnet_cidrs" { type = list(string) }
variable "private_app_subnet_cidrs" { type = list(string) }
variable "private_db_subnet_cidrs" { type = list(string) }
variable "enable_nat_gateway" { type = bool }

variable "app_port" { type = number }
variable "health_check_path" { type = string }
variable "app_image_tag" { type = string }
variable "ecs_cpu" { type = number }
variable "ecs_memory" { type = number }
variable "ecs_desired_count" { type = number }

variable "db_name" { type = string }
variable "db_username" { type = string }
variable "db_password" {
  type      = string
  sensitive = true
}
variable "db_instance_class" { type = string }
variable "db_allocated_storage" { type = number }
variable "db_backup_retention_days" { type = number }
variable "db_deletion_protection" { type = bool }

variable "log_retention_days" { type = number }
variable "alarm_email" { type = string }

variable "enable_daily_scheduler" { type = bool }
variable "daily_schedule_expression" { type = string }
