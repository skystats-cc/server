# skystats server

Backend for skystats.cc: Hypixel ingestion, snapshot storage, and the public API.

One codebase, two processes:

- **api** (`src/apps/api.ts`) serves HTTP: the public API under `/v1`, health checks, and the admin endpoints under `/admin`.
- **worker** (`src/apps/worker.ts`) runs ingestion:
  - polls the whole Bazaar every 30s into `bazaar_products` (realtime view)
  - copies every product into `bazaar_snapshots` every 2h (history, append-only)
  - polls status.hypixel.net every 60s into `hypixel_status`

## Stack

Node 22 · TypeScript · Fastify · Drizzle ORM · Postgres · pg-boss · zod · pino · vitest

## Getting started

```bash
npm install
cp .env.example .env                              # then edit values
docker compose -f docker-compose.dev.yml up -d    # local Postgres
npm run db:generate                               # only after changing src/db/schema.ts
npm run db:migrate
npm run dev:api        # terminal 1, http://localhost:3000/healthz
npm run dev:worker     # terminal 2
```

## Layout

```
src/
  apps/       entry points (api, worker)
  modules/    one folder per domain: routes -> service -> repo, plus jobs
  ingest/     upstream API client, shared rate limiter, response schemas
  db/         Drizzle schema, client, migrate script
  jobs/       pg-boss setup + module registry
  http/       Fastify setup, middleware
  ops/        health checks, admin endpoints (used by the MCP server)
  lib/        config, logger, errors
drizzle/      generated SQL migrations (commit these, never edit after merge)
```

## Production

CI builds `ghcr.io/skystats-cc/server` on every merge to `main` (`docker.yml`). The `infra` repo runs it as three containers from one image: `migrate` (once), `api`, `worker`.

The public API is rate limited per client IP (`RATE_LIMIT_PER_MIN`, default 120; health and admin routes exempt). Behind Cloudflare the client IP comes from `cf-connecting-ip`. The API contract lives in the `api-spec` repo; keep `openapi.yaml` in sync when you change a route.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | process up |
| GET | `/readyz` | DB reachable |
| GET | `/v1/bazaar?q=` | every product's latest prices, optional search |
| GET | `/v1/bazaar/:productId` | one product, e.g. `ENCHANTED_DIAMOND` |
| GET | `/v1/bazaar/:productId/history?days=7` | snapshots (1–90 days) |
| GET | `/v1/status` | cached status.hypixel.net (`indicator`: none/minor/major/critical/unknown) |
| GET | `/admin/queues` | needs `x-admin-key` |
| POST | `/admin/bazaar/snapshot` | needs `x-admin-key`; snapshot now |
| POST | `/admin/restart` | needs `x-admin-key`; relies on container restart policy |

## TODO

- Real item names from `/v2/resources/skyblock/items` (currently title-cased ids).
- Cap history by subscription tier (FREE 7d / PRO 90d / MAX unlimited) + retention cleanup job.
- Discord auth + API keys for `/v1`.
- Validate requests/responses against the `api-spec` repo once it exists.
