variable "project" { type = string }
variable "environment" { type = string }
variable "app_image" { type = string }
variable "app_port" { type = number }
variable "cpu" { type = number }
variable "memory" { type = number }
variable "desired_count" { type = number }
variable "private_app_subnet_ids" { type = list(string) }
variable "ecs_security_group_id" { type = string }
variable "target_group_arn" { type = string }
variable "log_group_name" { type = string }
variable "environment_variables" {
  type    = map(string)
  default = {}
}
variable "secret_environment_variables" {
  type = map(string)
  default = {}
}
