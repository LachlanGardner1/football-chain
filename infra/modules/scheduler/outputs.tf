output "rule_name" {
  value = var.enabled ? aws_cloudwatch_event_rule.daily[0].name : null
}
