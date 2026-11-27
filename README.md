# skystats server

Backend for skystats.cc: Hypixel ingestion, snapshot storage, and the public API.

One codebase, two processes:

- **api** (`src/apps/api.ts`) serves HTTP: the public API under `/v1`, health checks, and the admin endpoints under `/admin`.
- **worker** (`src/apps/worker.ts`) runs ingestion:
  - polls the whole Bazaar every 30s into `bazaar_products` (realtime view)
  - copies every product into `bazaar_snapshots` every 2h (history, append-only)
  - polls status.hypixel.net every 60s into `hypixel_status`
  - fetches SkyBlock profiles + co-op members from Hypixel (on login, mod heartbeats, page views; at most every 5 min per player), stores money snapshots, resolves member names via Mojang

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

## Accounts & pairing

```
website ─ POST /v1/pairing ─────────► code ABCD-EFGH (+ secret kept in the browser)
player  ─ /skystats link ABCD-EFGH ─► [Confirm] in chat
mod     ─ challenge → Mojang joinServer(serverId) → verify (server asks Mojang hasJoined) → mod token
mod     ─ POST /v1/pairing/claim ───► linked
website ─ POST /v1/pairing/:id/poll ─► status=linked + HttpOnly ss_session cookie
```

Tokens are random and stored as SHA-256 hashes (`sessions`). Pairing codes expire after 10 minutes and work once.

## SkyBlock data model

`players` (every Minecraft UUID we've seen) · `accounts` (players who signed in) · `skyblock_profiles` · `profile_members` (the co-op "group"; members who left or haven't accepted are `active=false`) · `member_snapshots` (purse, banks, SkyBlock XP over time; skipped for players with tracking off).

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
| POST | `/v1/auth/mod/challenge`, `/v1/auth/mod/verify` | mod login via Mojang `hasJoined` (token never leaves the player) |
| POST | `/v1/pairing` → `/v1/pairing/:id/poll` | website pairing code; poll sets the `ss_session` cookie |
| POST | `/v1/pairing/claim` | mod claims the code (`/skystats link CODE`) |
| POST | `/v1/mod/heartbeat` | mod is running (every 5 min on Hypixel) |
| GET / PATCH | `/v1/me`, `/v1/me/settings` | account, tracking on/off |
| GET / POST | `/v1/me/profiles`, `/v1/me/profiles/refresh` | your profiles + co-op members |
| GET | `/v1/status` | cached status.hypixel.net (`indicator`: none/minor/major/critical/unknown) |
| GET | `/admin/queues` | needs `x-admin-key` |
| POST | `/admin/players/:uuid/refresh` | needs `x-admin-key`; fetch a player's profiles now |
| POST | `/admin/bazaar/snapshot` | needs `x-admin-key`; snapshot now |
| POST | `/admin/restart` | needs `x-admin-key`; relies on container restart policy |

## TODO

- Real item names from `/v2/resources/skyblock/items` (currently title-cased ids).
- Cap history by subscription tier (FREE 7d / PRO 90d / MAX unlimited) + retention cleanup job.
- Discord auth + API keys for `/v1`.
- Validate requests/responses against the `api-spec` repo once it exists.
