locals {
  name_prefix = "${var.project}-${var.environment}"
}

# Placeholder only - this ports the *mechanism* (a daily scheduled invocation) from the
# old ECS RunTask wiring. There is no daily-puzzle-publish logic in the app yet (confirmed
# absent during the Lambda migration review); the real publish job is separate future work.
data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/.build/${local.name_prefix}-daily-publish-placeholder.zip"

  source {
    filename = "index.js"
    content  = <<-EOT
      exports.handler = async (event) => {
        console.log("Daily puzzle publish placeholder invoked - no publish logic implemented yet.", JSON.stringify(event));
        return { statusCode: 200 };
      };
    EOT
  }
}

resource "aws_iam_role" "placeholder" {
  count = var.enabled ? 1 : 0
  name  = "${local.name_prefix}-daily-publish-role"

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

resource "aws_iam_role_policy_attachment" "placeholder_logs" {
  count      = var.enabled ? 1 : 0
  role       = aws_iam_role.placeholder[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "placeholder" {
  count         = var.enabled ? 1 : 0
  function_name = "${local.name_prefix}-daily-publish-placeholder"
  role          = aws_iam_role.placeholder[0].arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  timeout = 10
}

resource "aws_cloudwatch_event_rule" "daily" {
  count               = var.enabled ? 1 : 0
  name                = "${local.name_prefix}-daily-publish"
  schedule_expression = var.schedule_expression
}

resource "aws_cloudwatch_event_target" "lambda" {
  count = var.enabled ? 1 : 0
  rule  = aws_cloudwatch_event_rule.daily[0].name
  arn   = aws_lambda_function.placeholder[0].arn
}

resource "aws_lambda_permission" "eventbridge" {
  count         = var.enabled ? 1 : 0
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.placeholder[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily[0].arn
}
