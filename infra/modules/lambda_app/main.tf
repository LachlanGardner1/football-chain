locals {
  name_prefix               = "${var.project}-${var.environment}"
  use_vpc                   = length(var.private_app_subnet_ids) > 0
  use_external_database_url = var.external_database_url_secret_arn != null
}

data "archive_file" "server" {
  type        = "zip"
  source_dir  = var.open_next_output_path
  output_path = "${path.module}/.build/${local.name_prefix}-server.zip"
}

# Exactly one of these two data sources is ever read (see local.use_external_database_url) -
# either an RDS-shaped username/password/dbname JSON secret, or a single secret already holding
# a complete connection string for an externally-hosted database (e.g. Neon).
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

# Generated once and stored centrally rather than passed through tfvars, so it never
# needs to exist in plaintext anywhere outside Secrets Manager and Lambda's own config.
resource "random_password" "session_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "session" {
  name = "${local.name_prefix}/session-secret"
}

resource "aws_secretsmanager_secret_version" "session" {
  secret_id     = aws_secretsmanager_secret.session.id
  secret_string = random_password.session_secret.result
}

resource "aws_iam_role" "lambda_exec" {
  name = "${local.name_prefix}-lambda-exec-role"

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

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Only needed when the Lambda is actually placed in a VPC - a non-VPC Lambda has no ENIs to
# manage and doesn't need this policy at all.
resource "aws_iam_role_policy_attachment" "vpc_access" {
  count      = local.use_vpc ? 1 : 0
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# DATABASE_URL/SESSION_SECRET are resolved from Secrets Manager once, here, at apply
# time and injected as plain Lambda environment variables. That's a deliberate scoping
# choice, not the strongest possible pattern (the AWS Parameters and Secrets Lambda
# Extension, fetching at runtime, would avoid the value ever sitting in the function's
# config/Terraform state) - revisit if/when the app is changed to fetch secrets itself.
resource "aws_lambda_function" "server" {
  function_name = "${local.name_prefix}-app"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = [var.architecture]

  filename         = data.archive_file.server.output_path
  source_code_hash = data.archive_file.server.output_base64sha256

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
      NODE_ENV       = "production"
      DATABASE_URL   = local.database_url
      SESSION_SECRET = random_password.session_secret.result
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = var.log_group_name
  }

  depends_on = [
    aws_iam_role_policy_attachment.basic_execution,
    aws_iam_role_policy_attachment.vpc_access,
  ]
}

# AWS_IAM auth (not NONE/public) - only CloudFront, via origin access control, can invoke
# this. See modules/cloudfront_lambda, which owns the aws_lambda_permission granting that
# access (it has the distribution ARN needed to scope the grant; this module doesn't).
resource "aws_lambda_function_url" "server" {
  function_name      = aws_lambda_function.server.function_name
  authorization_type = "AWS_IAM"
}
