variable "project" { type = string }
variable "environment" { type = string }

variable "open_next_output_path" {
  type        = string
  description = "Path to the OpenNext server function build output (.open-next/server-functions/default), produced by `npx open-next build` before `terraform apply`."
}

# VPC attachment is optional - null/empty means the Lambda is not placed in a VPC at all (its
# default networking already has internet access, no NAT needed). Only meaningful when the
# database is reached privately within a VPC (see rds_postgres) - an externally-hosted database
# reached over the public internet (e.g. Neon) doesn't need this at all.
variable "private_app_subnet_ids" {
  type    = list(string)
  default = []
}
variable "lambda_security_group_id" {
  type    = string
  default = null
}

# Exactly one of (db_secret_arn + db_endpoint + db_name) or external_database_url_secret_arn
# must be set. The former builds a postgres:// URL from RDS-shaped parts (username/password
# JSON secret + a separate endpoint); the latter reads a single Secrets Manager secret whose
# value is already a complete, ready-to-use connection string (e.g. Neon's pooled URL, which
# bundles credentials/host/db/sslmode itself and doesn't decompose into RDS's shape).
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

variable "log_group_name" { type = string }

variable "memory_size" {
  type    = number
  default = 512
}

variable "timeout" {
  type    = number
  default = 30
}

variable "architecture" {
  type    = string
  default = "arm64"
}
