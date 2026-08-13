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

# As of GitHub's April 2026 "immutable subject claims" change, the OIDC token's sub claim
# embeds numeric owner/repo IDs (repo:OWNER@OWNER-ID/REPO@REPO-ID:...) instead of just the
# reassignable names - find these under Settings -> General (repo ID) and the org/user's
# profile page or `gh api users/<owner>`/`gh api repos/<owner>/<repo>` (both id fields).
variable "github_owner_id" {
  type        = string
  description = "Numeric GitHub owner (org/user) ID - see `gh api users/<owner> --jq .id`."
}

variable "github_repo_id" {
  type        = string
  description = "Numeric GitHub repo ID - see `gh api repos/<owner>/<repo> --jq .id`."
}
