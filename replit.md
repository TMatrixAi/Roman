# Tennis Match Predictor

A tennis match prediction app: pick two players, get a calibrated win probability backed by a
multi-module prediction engine (surface Elo, serve/return, recent form, fatigue, style matchup,
head-to-head), plus a growing leak-proof historical match database for future model validation.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run backfill -- --start YYYY-MM-DD --stop YYYY-MM-DD [--cutoff 30min]` — backfill real historical matches + pre-match feature snapshots
- `pnpm --filter @workspace/api-server run test:leakage` — run the historical-data leakage test suite
- Required env: `DATABASE_URL` — Postgres connection string; `API_TENNIS_KEY` — API-Tennis provider key (live predictions and backfill both fail cleanly with a clear error if unset, never mock data)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/services/tennisData/` — provider-agnostic tennis data layer (API-Tennis today)
- `artifacts/api-server/src/services/predictionEngine/` — live, per-request prediction modules
- `artifacts/api-server/src/services/historicalData/` — leak-proof historical backfill pipeline (features, backfill runner, cutoff config, leakage tests)
- `lib/db/src/schema/predictions.ts` — saved live predictions + outcomes
- `lib/db/src/schema/historicalMatches.ts` — append-only historical matches + frozen pre-match feature snapshots
- `docs/audit-phase1.md`, `docs/audit-phase2.md`, `docs/audit-phase3.md` — running audit trail of data-quality findings and decisions per phase

## Architecture decisions

- This app never uses mock/fake data: if a provider field is unavailable it is `null`, not fabricated, and the whole prediction/backfill request fails cleanly (`ProviderUnavailableError`) if the provider itself is unreachable.
- `TennisDataProvider` is an interface so a second provider can be added later without touching call sites; the historical backfill pipeline also only depends on that interface (`getCompletedMatchesByDateRange`), not on API-Tennis directly.
- Historical matches and their pre-match feature snapshots are append-only and written once, in strict chronological order, so a feature can never be computed from a match that happens later — see `docs/audit-phase3.md` for the verification tests.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
