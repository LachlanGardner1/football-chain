variable "project" { type = string }
variable "environment" { type = string }
variable "db_name" { type = string }
variable "db_username" { type = string }
variable "db_password" {
  type      = string
  sensitive = true
}
variable "db_instance_class" { type = string }
variable "allocated_storage" { type = number }
variable "backup_retention_period" { type = number }
variable "deletion_protection" { type = bool }
variable "private_db_subnet_ids" { type = list(string) }
variable "rds_security_group_id" { type = string }
