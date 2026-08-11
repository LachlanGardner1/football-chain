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
