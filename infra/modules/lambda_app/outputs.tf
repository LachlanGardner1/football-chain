output "function_arn" {
  value = aws_lambda_function.server.arn
}

output "function_name" {
  value = aws_lambda_function.server.function_name
}

output "function_url" {
  value = aws_lambda_function_url.server.function_url
}

# CloudFront's custom_origin_config wants a bare hostname, not the full https:// URL.
output "function_url_domain" {
  value = trimsuffix(trimprefix(aws_lambda_function_url.server.function_url, "https://"), "/")
}
