locals {
  name_prefix               = "${var.project}-${var.environment}"
  use_vpc                   = length(var.private_app_subnet_ids) > 0
  use_external_database_url = var.external_database_url_secret_arn != null
}

# Runs the "migrate" and "rotate-puzzles" actions (scripts/ops-lambda/handler.ts). Both are
# invoked directly by GitHub Actions (deploy.yml / rotate-puzzles.yml) via `aws lambda
# invoke`, not on any AWS-native schedule - GitHub Actions is the sole scheduling source of
# truth so there's one place to see, change, and rerun cron history instead of two. VPC
# attachment (see local.use_vpc) is only needed when the database is RDS, reachable solely
# from inside the VPC - an externally-hosted database over the public internet (e.g. Neon)
# needs neither the VPC nor the private-subnet routing this Lambda would otherwise use.
data "archive_file" "ops" {
  type        = "zip"
  source_dir  = var.ops_lambda_build_path
  output_path = "${path.module}/.build/${local.name_prefix}-ops.zip"
}

data "aws_secretsmanager_secret_version" "db" {
  count     = local.use_external_database_url ? 0 : 1
  secret_id = var.db_secret_arn
}

data "aws_secretsmanager_secret_version" "external_database_url" {
  count     = local.use_external_database_url ? 1 : 0
  secret_id = var.external_database_url_secret_arn
}

locals {
  database_url = local.use_external_database_url ? (
    data.aws_secretsmanager_secret_version.external_database_url[0].secret_string
    ) : (
    "postgres://${jsondecode(data.aws_secretsmanager_secret_version.db[0].secret_string).username}:${jsondecode(data.aws_secretsmanager_secret_version.db[0].secret_string).password}@${var.db_endpoint}:5432/${var.db_name}"
  )
}

resource "aws_iam_role" "ops_lambda_exec" {
  name = "${local.name_prefix}-ops-lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ops_basic_execution" {
  role       = aws_iam_role.ops_lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "ops_vpc_access" {
  count      = local.use_vpc ? 1 : 0
  role       = aws_iam_role.ops_lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_lambda_function" "ops" {
  function_name = "${local.name_prefix}-ops"
  role          = aws_iam_role.ops_lambda_exec.arn
  handler       = "ops-lambda/index.handler"
  runtime       = "nodejs20.x"
  architectures = [var.architecture]

  filename         = data.archive_file.ops.output_path
  source_code_hash = data.archive_file.ops.output_base64sha256

  memory_size = var.memory_size
  timeout     = var.timeout

  dynamic "vpc_config" {
    for_each = local.use_vpc ? [1] : []
    content {
      subnet_ids         = var.private_app_subnet_ids
      security_group_ids = [var.lambda_security_group_id]
    }
  }

  environment {
    variables = {
      NODE_ENV     = "production"
      DATABASE_URL = local.database_url
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = var.log_group_name
  }

  depends_on = [
    aws_iam_role_policy_attachment.ops_basic_execution,
    aws_iam_role_policy_attachment.ops_vpc_access,
  ]
}
