# skystats server

Backend for skystats.cc: data ingestion, snapshot storage, and the public API.

One codebase, two processes:

- **api** (`src/apps/api.ts`) serves HTTP: the public API under `/v1`, health checks, and the admin endpoints under `/admin`.
- **worker** (`src/apps/worker.ts`) runs ingestion and scheduled jobs (pg-boss, stored in Postgres).

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

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | process up |
| GET | `/readyz` | DB reachable |
| GET | `/v1/players/:uuid` | latest snapshot; unknown players are queued for fetch (404 until ready) |
| GET | `/v1/players/:uuid/history?limit=50` | snapshot history |
| GET | `/admin/queues` | needs `x-admin-key` |
| POST | `/admin/players/:uuid/refresh` | needs `x-admin-key` |
| POST | `/admin/restart` | needs `x-admin-key`; relies on container restart policy |

## TODO

- Fill in the real upstream response shape in `src/ingest/schemas.ts` and the auth header in `src/ingest/client.ts`.
- Validate requests/responses against the `api-spec` repo once it exists.
