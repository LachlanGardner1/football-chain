terraform {
  backend "s3" {
    bucket         = "football-chain-terraform-state"
    key            = "dev/terraform.tfstate"
    region         = "ap-southeast-2"
    dynamodb_table = "football-chain-terraform-locks"
    encrypt        = true
  }
}
