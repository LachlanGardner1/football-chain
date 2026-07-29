# Terraform v1 Checklist (ALB + CloudFront first, Route53 later)

This checklist is organized by file/module so you can build in order and review quickly.

## Target v1 (now)
- Public CloudFront URL (default domain)
- CloudFront -> ALB -> ECS Fargate -> RDS PostgreSQL
- No Route53 custom domain yet

## Suggested layout

```
infra/
  environments/
    dev/
      backend.tf
      providers.tf
      versions.tf
      variables.tf
      terraform.tfvars.example
      main.tf
      outputs.tf
    prod/
      backend.tf
      providers.tf
      versions.tf
      variables.tf
      terraform.tfvars.example
      main.tf
      outputs.tf
  modules/
    network/
      main.tf
      variables.tf
      outputs.tf
    security/
      main.tf
      variables.tf
      outputs.tf
    rds_postgres/
      main.tf
      variables.tf
      outputs.tf
    ecr/
      main.tf
      variables.tf
      outputs.tf
    ecs_service/
      main.tf
      variables.tf
      outputs.tf
    alb/
      main.tf
      variables.tf
      outputs.tf
    cloudfront_alb/
      main.tf
      variables.tf
      outputs.tf
    scheduler/
      main.tf
      variables.tf
      outputs.tf
    observability/
      main.tf
      variables.tf
      outputs.tf
```

## File/module checklist

### `environments/*/versions.tf`
- [ ] Pin Terraform version
- [ ] Pin AWS provider version

### `environments/*/providers.tf`
- [ ] Configure AWS provider region
- [ ] Configure default tags (project, env, owner)

### `environments/*/backend.tf`
- [ ] S3 backend for state
- [ ] DynamoDB state lock table

### `modules/network/main.tf`
- [ ] VPC
- [ ] 2+ public subnets (ALB)
- [ ] 2+ private app subnets (ECS)
- [ ] 2+ private db subnets (RDS)
- [ ] Internet Gateway
- [ ] NAT Gateway (or documented no-NAT variant)
- [ ] Route tables and associations
- [ ] DB subnet group

### `modules/security/main.tf`
- [ ] ALB security group (ingress 80/443 from internet)
- [ ] ECS security group (ingress app port from ALB SG only)
- [ ] RDS security group (ingress 5432 from ECS SG only)
- [ ] Egress rules (least privilege where practical)

### `modules/ecr/main.tf`
- [ ] ECR repository for app image
- [ ] Lifecycle policy (delete old untagged images)

### `modules/rds_postgres/main.tf`
- [ ] RDS PostgreSQL instance
- [ ] Parameter group (timezone, logging as needed)
- [ ] Storage encryption
- [ ] Automated backups
- [ ] Performance Insights optional
- [ ] Secrets Manager for DB credentials
- [ ] Deletion protection in prod

### `modules/alb/main.tf`
- [ ] ALB
- [ ] Target group (ECS task port)
- [ ] Listener 80 (redirect to 443 optional)
- [ ] Listener 443 only when custom cert/domain is added
- [ ] Health check path (`/api/health`)

### `modules/ecs_service/main.tf`
- [ ] ECS cluster
- [ ] Task execution role + task role
- [ ] Task definition (CPU/memory/container)
- [ ] Service with desired count >= 1
- [ ] Service attached to ALB target group
- [ ] Container env vars (non-secret)
- [ ] Secrets from Secrets Manager
- [ ] CloudWatch log configuration
- [ ] Auto scaling policy (start minimal)

### `modules/cloudfront_alb/main.tf`
- [ ] CloudFront distribution
- [ ] Custom origin = ALB DNS
- [ ] Viewer protocol policy: redirect-to-https
- [ ] Cache policy tuned for API + static
- [ ] Origin request policy forwarding required headers/cookies/query
- [ ] WAF optional later
- [ ] Output default CloudFront domain

### `modules/scheduler/main.tf`
- [ ] EventBridge rule (daily publish time)
- [ ] Target = ECS run task OR Lambda
- [ ] IAM role for scheduler target invoke

### `modules/observability/main.tf`
- [ ] CloudWatch log groups with retention
- [ ] Alarms: ECS task unhealthy, ALB 5xx, RDS CPU/storage
- [ ] SNS topic for alerts

### `environments/*/main.tf`
- [ ] Instantiate all modules in dependency order
- [ ] Wire outputs to inputs (subnets, SGs, ARNs, DNS names)

### `environments/*/variables.tf`
- [ ] Region/env/project/app image tag
- [ ] DB size/backup settings
- [ ] ECS CPU/memory/desired_count
- [ ] Daily scheduler cron/timezone

### `environments/*/outputs.tf`
- [ ] `cloudfront_domain_name`
- [ ] `alb_dns_name`
- [ ] `rds_endpoint`
- [ ] `ecr_repository_url`

## Security and reliability gates before go-live
- [ ] No public RDS
- [ ] DB credentials only in Secrets Manager
- [ ] At-rest encryption enabled (RDS, logs where possible)
- [ ] Health endpoint implemented and wired
- [ ] Backup restore tested in dev
- [ ] Alarms notify real destination

## Phase 2 (later): Route53 + custom domain
- [ ] ACM cert in `us-east-1` for CloudFront
- [ ] Add CloudFront alternate domain names
- [ ] Route53 alias A/AAAA to CloudFront
- [ ] Optional www/apex redirect strategy
