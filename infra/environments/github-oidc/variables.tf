variable "project" { type = string }
variable "aws_region" { type = string }

variable "github_owner" {
  type        = string
  description = "GitHub org/user that owns the repo, e.g. \"LachlanGardner1\"."
}

variable "github_repo" {
  type        = string
  description = "Repo name only (no owner), e.g. \"football-chain\"."
}
