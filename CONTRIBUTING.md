# Contributing

## Branches & PRs

- `main` is always deployable. Never push to it directly.
- Branch as `feat/<thing>`, `fix/<thing>`, or `chore/<thing>`.
- Open a PR. CI (typecheck + tests) must pass and one review is required before merging.
- Keep PRs small: one feature or fix per PR.

## Adding a module

Copy `src/modules/players/` as the template. A module has:

| File | Does | Must not |
|---|---|---|
| `x.routes.ts` | validate input with zod, call the service | touch the DB |
| `x.service.ts` | business logic | know about HTTP or write SQL |
| `x.repo.ts` | DB queries | contain business logic |
| `x.jobs.ts` | export `queues` + `registerWorkers(boss)` | call upstream directly (go through `src/ingest`) |
| `x.queues.ts` | queue name constants | |

Then:

1. Add tables to `src/db/schema.ts` and run `npm run db:generate`. Commit the generated SQL in `drizzle/`.
2. Register routes in `src/http/server.ts`.
3. Add the module to `src/jobs/registry.ts`.

## Rules

- **Snapshots are append-only.** Never update or delete snapshot rows.
- **All upstream calls go through `src/ingest/client.ts`** so the shared rate limiter applies.
- **Never edit a migration after it's merged.** Write a new one.
- Config comes from env vars via `src/lib/config.ts`. Add new vars there and to `.env.example`.
