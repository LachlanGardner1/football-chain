Local testing workflow

1. Start local Postgres
- docker compose up -d

2. Configure env
- Copy .env.example to .env
- Use this value:
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/football_chain

3. Install dependencies
- npm install

4. Run migrations and seed
- npm run db:migrate
- npm run db:seed

5. Run app locally
- npm run dev

6. Quick API checks
- GET /api/health
- GET /api/daily
- POST /api/complete with userId 11111111-1111-4111-8111-111111111111
- GET /api/me/stats with header x-user-id: 11111111-1111-4111-8111-111111111111

7. Reset local DB quickly
- docker compose down -v
- docker compose up -d
- npm run db:migrate
- npm run db:seed

Notes
- This local path exercises both frontend and backend route logic without any AWS cost.
- Keep terraform.tfvars for real cloud credentials/settings, and local testing in .env + Docker.
