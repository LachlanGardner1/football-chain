variable "project" { type = string }
variable "environment" { type = string }

variable "ops_lambda_build_path" {
  type        = string
  description = "Path to the built ops Lambda bundle directory (dist/), produced by `npm run build:ops-lambda` before `terraform apply`. Contains ops-lambda/index.js and db/migrations/*.sql."
}

variable "private_app_subnet_ids" { type = list(string) }
variable "lambda_security_group_id" { type = string }

variable "db_secret_arn" {
  type        = string
  description = "ARN of the Secrets Manager secret created by the rds_postgres module (holds username/password/dbname)."
}
variable "db_endpoint" { type = string }
variable "db_name" { type = string }

variable "log_group_name" { type = string }

variable "memory_size" {
  type    = number
  default = 512
}

variable "timeout" {
  type    = number
  default = 60
}

variable "architecture" {
  type    = string
  default = "arm64"
}
