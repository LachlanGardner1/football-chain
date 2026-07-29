locals {
  name_prefix = "${var.project}-${var.environment}"
}

resource "aws_iam_role" "scheduler_invoke" {
  count = var.enabled ? 1 : 0
  name  = "${local.name_prefix}-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "events.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  count = var.enabled ? 1 : 0
  name  = "${local.name_prefix}-scheduler-policy"
  role  = aws_iam_role.scheduler_invoke[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["ecs:RunTask"]
        Resource = [var.task_definition_arn]
      },
      {
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [var.task_role_arn]
      }
    ]
  })
}

resource "aws_cloudwatch_event_rule" "daily" {
  count               = var.enabled ? 1 : 0
  name                = "${local.name_prefix}-daily-publish"
  schedule_expression = var.schedule_expression
}

resource "aws_cloudwatch_event_target" "ecs" {
  count    = var.enabled ? 1 : 0
  rule     = aws_cloudwatch_event_rule.daily[0].name
  arn      = var.cluster_arn
  role_arn = aws_iam_role.scheduler_invoke[0].arn

  ecs_target {
    launch_type         = "FARGATE"
    task_count          = 1
    task_definition_arn = var.task_definition_arn

    network_configuration {
      subnets         = var.subnet_ids
      security_groups = var.security_group_ids
    }
  }
}
