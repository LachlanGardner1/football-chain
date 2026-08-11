# One-time bootstrap, applied manually by a human with real AWS credentials - deliberately
# kept out of the regular dev/prod apply cycle (see infra/TERRAFORM_CHECKLIST.md). Everything
# below exists so GitHub Actions can authenticate to AWS without any long-lived access keys
# ever being stored as a repo secret: it exchanges a short-lived OIDC token for temporary
# credentials under one of the two roles here, scoped by the "sub" claim to this exact repo.
#
# Two roles, not one, on a least-privilege split:
#  - deploy: broad (terraform apply-level) permissions, used only by deploy.yml on pushes to
#    main.
#  - invoke_ops_lambda: just lambda:InvokeFunction on the ops Lambda, used by both deploy.yml
#    (to trigger the "migrate" action after apply) and rotate-puzzles.yml (daily "rotate-
#    puzzles" trigger) - deploy.yml assumes both roles in sequence, never combining their
#    permissions into one.

data "aws_caller_identity" "current" {}

# GitHub's own documented root CA thumbprint for token.actions.githubusercontent.com. AWS has
# validated the OIDC provider's TLS certificate chain directly (ignoring this value) since
# mid-2023, but the Terraform AWS provider's schema still requires a non-empty list here.
locals {
  github_oidc_thumbprint = "6938fd4d98bab03faadb97b34396831e3780aea1"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [local.github_oidc_thumbprint]
}

locals {
  repo_sub = "repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/main"
}

# --- Deploy role: terraform apply + the deploy-time "migrate" invoke -----------------------

resource "aws_iam_role" "deploy" {
  name = "${var.project}-gha-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = local.repo_sub
        }
      }
    }]
  })
}

# Covers EC2/VPC, RDS, Lambda, S3, CloudFront, Secrets Manager, CloudWatch Logs/Alarms, SNS,
# and DynamoDB (state locking) - everything the network/security/rds_postgres/lambda_app/
# cloudfront_lambda/observability/ops_lambda modules touch. PowerUserAccess explicitly
# excludes IAM and Organizations management, which is exactly the boundary we want: the
# custom policy below re-grants only the narrow slice of IAM actions Terraform actually needs
# (creating/managing this project's own Lambda exec roles), scoped by name so it can't touch
# any other IAM resource in the account.
resource "aws_iam_role_policy_attachment" "deploy_power_user" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

resource "aws_iam_role_policy" "deploy_scoped_iam" {
  name = "${var.project}-gha-deploy-scoped-iam"
  role = aws_iam_role.deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:ListAttachedRolePolicies",
        "iam:ListRolePolicies",
        "iam:PassRole",
      ]
      # Matches the "${project}-${environment}-*-role" naming convention every module in
      # infra/modules uses (e.g. football-chain-dev-lambda-exec-role,
      # football-chain-dev-ops-lambda-exec-role) - this role can only manage IAM roles that
      # belong to this project, nothing else in the account.
      Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project}-*"
    }]
  })
}

# --- Invoke-only role: triggers the ops Lambda, nothing else -------------------------------

resource "aws_iam_role" "invoke_ops_lambda" {
  name = "${var.project}-gha-invoke-ops-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = local.repo_sub
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "invoke_ops_lambda" {
  name = "${var.project}-gha-invoke-ops-lambda"
  role = aws_iam_role.invoke_ops_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.project}-*-ops"
    }]
  })
}
