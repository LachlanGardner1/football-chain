# Add these as GitHub Actions repo variables (Settings -> Secrets and variables -> Actions ->
# Variables tab - ARNs aren't secret, no need for the Secrets tab): AWS_DEPLOY_ROLE_ARN and
# AWS_INVOKE_OPS_LAMBDA_ROLE_ARN, referenced by .github/workflows/deploy.yml and
# rotate-puzzles.yml respectively.

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "invoke_ops_lambda_role_arn" {
  value = aws_iam_role.invoke_ops_lambda.arn
}
