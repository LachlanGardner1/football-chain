output "cloudfront_domain_name" {
  value = module.cloudfront.distribution_domain_name
}

output "alb_dns_name" {
  value = module.alb.alb_dns_name
}

output "rds_endpoint" {
  value = module.rds.endpoint
}

output "ecr_repository_url" {
  value = module.ecr.repository_url
}
