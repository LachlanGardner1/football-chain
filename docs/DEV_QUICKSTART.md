# Dev quickstart

## 1) Prerequisites

- Node.js 20+
- npm
- PostgreSQL 14+

## 2) Configure env

Copy `.env.example` to `.env` and set `DATABASE_URL`.

Example:

`DATABASE_URL=postgres://postgres:postgres@localhost:5432/football_chain`

## 3) Install deps

`npm install`

## 4) Apply schema and seed

`npm run db:migrate`

`npm run db:seed`

## 5) Start app

Use your existing Next.js startup command, for example:

`npm run dev`

## 6) Smoke tests

- GET `/api/health` should return `{ ok: true }`
- GET `/api/daily` should return the published puzzle for today
- POST `/api/validate-chain`
- Use `x-user-id: 11111111-1111-4111-8111-111111111111` for `/api/me/stats`
- Use `userId: "11111111-1111-4111-8111-111111111111"` in `/api/complete`

Example body:

```json
{
  "startPlayerId": 1,
  "targetPlayerId": 5,
  "chain": [
    { "id": 1, "type": "PLAYER" },
    { "id": 1, "type": "CLUB" }
  ]
}
```

Adjust IDs to match your seeded data.

## 7) Terraform dev plan

`cd infra/environments/dev`

`terraform init`

`terraform plan -var-file=terraform.tfvars`

Use `terraform.tfvars.example` as your base.
