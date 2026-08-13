# These (unlike neon_database_url below) are fixed facts about this one environment directory,
# not secrets - defaulted here rather than left required, so a non-interactive `terraform plan`
# (CI) doesn't block waiting on stdin for values that never vary. terraform.tfvars.example still
# documents them for anyone who wants to override locally.
variable "project" {
  type    = string
  default = "football-chain"
}
variable "environment" {
  type    = string
  default = "dev"
}
variable "aws_region" {
  type    = string
  default = "ap-southeast-2"
}

variable "lambda_memory_size" {
  type    = number
  default = 512
}
variable "lambda_timeout" {
  type    = number
  default = 30
}

# Full Postgres connection string from Neon's dashboard - use the POOLED endpoint, not the
# direct one (see the setup steps in main.tf). Supply via terraform.tfvars (gitignored,
# already covered by the repo's root .gitignore `**/terraform.tfvars` rule) or a
# TF_VAR_neon_database_url env var - never commit the real value. Genuinely no safe default,
# unlike the vars above.
variable "neon_database_url" {
  type      = string
  sensitive = true
}

variable "log_retention_days" {
  type    = number
  default = 14
}
variable "alarm_email" {
  type    = string
  default = ""
}
