provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project
      Purpose   = "github-actions-oidc"
      ManagedBy = "terraform"
    }
  }
}
