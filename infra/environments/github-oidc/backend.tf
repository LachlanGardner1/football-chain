terraform {
  backend "s3" {
    bucket         = "football-chain-terraform-state"
    key            = "github-oidc/terraform.tfstate"
    region         = "ap-southeast-2"
    dynamodb_table = "football-chain-terraform-locks"
    encrypt        = true
  }
}
