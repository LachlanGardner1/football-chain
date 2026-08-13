variable "project" { type = string }
variable "environment" { type = string }

variable "ops_lambda_build_path" {
  type        = string
  description = "Path to the built ops Lambda bundle directory (dist/), produced by `npm run build:ops-lambda` before `terraform apply`. Contains ops-lambda/index.js and db/migrations/*.sql."
}

# See infra/modules/lambda_app/variables.tf for the identical reasoning - VPC attachment and
# the database connection source are both optional/pluggable, since an externally-hosted
# database (e.g. Neon) needs neither RDS-shaped credentials nor private VPC networking.
variable "private_app_subnet_ids" {
  type    = list(string)
  default = []
}
variable "lambda_security_group_id" {
  type    = string
  default = null
}

variable "db_secret_arn" {
  type        = string
  default     = null
  description = "ARN of the Secrets Manager secret created by the rds_postgres module (holds username/password/dbname)."
}
variable "db_endpoint" {
  type    = string
  default = null
}
variable "db_name" {
  type    = string
  default = null
}
variable "external_database_url_secret_arn" {
  type        = string
  default     = null
  description = "ARN of a Secrets Manager secret holding a complete DATABASE_URL connection string, for a non-RDS database host."
}

# See infra/modules/lambda_app/variables.tf for why this can't just be inferred from
# `external_database_url_secret_arn != null` - the ARN can be unknown at plan time.
variable "use_external_database_url" {
  type    = bool
  default = false
}

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
