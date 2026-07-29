locals {
  name_prefix = "${var.project}-${var.environment}"
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name_prefix}-app"
  retention_in_days = var.log_retention_days
}

resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}
