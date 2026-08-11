variable "project" { type = string }
variable "environment" { type = string }

variable "lambda_function_name" { type = string }
variable "lambda_function_url_domain" { type = string }

variable "open_next_assets_path" {
  type        = string
  description = "Path to the OpenNext static assets build output (.open-next/assets), synced to S3 on apply."
}
