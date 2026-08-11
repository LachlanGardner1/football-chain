output "distribution_domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}

output "assets_bucket_name" {
  value = aws_s3_bucket.assets.bucket
}
