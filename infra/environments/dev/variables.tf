variable "project" { type = string }
variable "environment" { type = string }
variable "aws_region" { type = string }

variable "lambda_memory_size" { type = number }
variable "lambda_timeout" { type = number }

# Full Postgres connection string from Neon's dashboard - use the POOLED endpoint, not the
# direct one (see the setup steps in main.tf). Supply via terraform.tfvars (gitignored,
# already covered by the repo's root .gitignore `**/terraform.tfvars` rule) or a
# TF_VAR_neon_database_url env var - never commit the real value.
variable "neon_database_url" {
  type      = string
  sensitive = true
}

variable "log_retention_days" { type = number }
variable "alarm_email" { type = string }
