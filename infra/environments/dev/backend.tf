terraform {
  backend "s3" {
    bucket       = "football-chain-terraform-state"
    key          = "dev/terraform.tfstate"
    region       = "ap-southeast-2"
    use_lockfile = true
    encrypt      = true
  }
}
