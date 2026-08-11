output "cloudfront_domain_name" {
  value = module.cloudfront.distribution_domain_name
}

output "lambda_function_url" {
  value = module.lambda_app.function_url
}

output "rds_endpoint" {
  value = module.rds.endpoint
}

output "static_assets_bucket" {
  value = module.cloudfront.assets_bucket_name
}

# GitHub Actions reads this (via `terraform output -raw ops_lambda_function_name`) to know
# what to `aws lambda invoke` for the migrate/rotate-puzzles actions - see
# .github/workflows/deploy.yml and rotate-puzzles.yml.
output "ops_lambda_function_name" {
  value = module.ops_lambda.function_name
}
