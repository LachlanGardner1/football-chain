output "log_group_name" {
  value = aws_cloudwatch_log_group.app.name
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}
