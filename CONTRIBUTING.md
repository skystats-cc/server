# Contributing

## Branches & PRs

- `main` is always deployable. Never push to it directly.
- Branch as `feat/<thing>`, `fix/<thing>`, or `chore/<thing>`.
- Open a PR. CI (typecheck + tests) must pass and one review is required before merging.
- Keep PRs small: one feature or fix per PR.

## Adding a module

Copy `src/modules/bazaar/` as the template. A module has:

| File | Does | Must not |
|---|---|---|
| `x.routes.ts` | validate input with zod, call the service | touch the DB |
| `x.service.ts` | business logic | know about HTTP or write SQL |
| `x.repo.ts` | DB queries | contain business logic |
| `x.jobs.ts` | export `queues` + `registerWorkers(boss)`; use pg-boss cron for ≥1 min jobs, `every()` from `src/jobs/loop.ts` for faster loops | call upstream directly (go through `src/ingest`) |
| `x.queues.ts` | queue name constants | |

Then:

1. Add tables to `src/db/schema.ts` and run `npm run db:generate`. Commit the generated SQL in `drizzle/`.
2. Register routes in `src/http/server.ts`.
3. Add the module to `src/jobs/registry.ts`.

## Rules

- **Snapshots are append-only.** Never update snapshot rows. The only deletes allowed are the tier-retention job and account erasure (UK GDPR Article 17), both in `src/modules/money` and `src/modules/privacy`.
- **No polling the Hypixel API for history.** Hypixel's API policy forbids it. Money history comes only from the mod (`POST /v1/mod/snapshot`); profile lookups are on demand and cached for `PROFILE_REFRESH_MIN_MINUTES`.
- **High privacy by default.** New account settings that share data (public profile, leaderboards, pings) must default to off (ICO Children's Code).
- **Gate features with `entitlementsService.require()`** and the `FEATURES` map in `src/modules/entitlements/tiers.ts`, never by checking Stripe directly.
- **All Hypixel calls go through `src/ingest/hypixel.ts`** so the shared rate limiter applies.
- **Never edit a migration after it's merged.** Write a new one.
- Config comes from env vars via `src/lib/config.ts`. Add new vars there and to `.env.example`.
