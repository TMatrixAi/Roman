# Four-Area Investigation & Fix Report

**Audit date:** 2026-07-15  
**Task:** #4 — Four open investigation & fix areas

---

## Area 1 — Shadow Replay Trustworthiness

### Finding: No leakage. All isolation guarantees confirmed.

**Storage isolation:**
- Every shadow-replay row is written with `runKind: 'paper_trade_shadow'` exclusively. The `overwrite: true` path deletes only rows matching `(runKind = 'paper_trade_shadow' AND shadowBatchLabel = <exact batch>)` — it cannot touch `paper_trade`, `live`, or `historical_test` rows regardless of the flag.
- The `(runKind, historicalMatchId)` unique index enforces append-only semantics at the DB level. A second replay over an overlapping range skips already-claimed matches via `onConflictDoNothing`; it cannot silently re-score or duplicate them.

**Reporting isolation:**
- `GET /evaluation/dashboard` queries only `runKind IN ('historical_test', 'paper_trade', 'live')`. Shadow rows never reach this endpoint's metrics, segment tables, calibration buckets, Elite tier backtest, or market-edge summary.
- `GET /evaluation/shadow-replay/dashboard` is a completely separate endpoint that queries only `runKind = 'paper_trade_shadow'`. Its disclosure text in the frontend (`ShadowReplay.tsx`) reads: *"Results here represent a best-case upper bound on engine performance, not a live trading track record."*

**Calibration honesty:**
- Each replayed match uses the calibration mapping that was actually active as of that match's own `cutoffAt` (`getCalibrationMappingAsOf`), not today's active mapping applied uniformly. This is the Task #160 guarantee — confirmed implemented and test-covered in `shadowReplay.test.ts` (the `applies the calibration mapping that was actually active` test explicitly seeds two synthetic calibration rows bracketing the match's cutoff and asserts the historically-active one was used, not the newer `active: true` one).

**Test coverage:**
`shadowReplay.test.ts` asserts: append-only semantics, no duplicates on re-run, batch B cannot steal batch A's matches, `overwrite: true` touches only the named batch, `historical_test`/`paper_trade`/`live` rows are untouched throughout, date-range filtering is exact, blank `batchLabel` is rejected.

**Code change:** None required.

---

## Area 2 — UI Honesty for Strong Recommendation / Elite

### Finding: Labels and disclaimers are honest. One stale-count fix applied.

**What is correct:**
- `STRONG_RECOMMENDATION` is displayed as **HIGH CONFIDENCE** (renamed in `PredictionResult.tsx` to avoid an endorsement the evidence doesn't back).
- Badge tooltip: *"The engine's highest-confidence call by its own gating criteria — backtesting has not yet shown this tier beating other tiers, so treat it as a signal, not a guarantee."*
- Elite badge tooltip: *"Still an early, small-sample tier — not yet statistically proven to outperform non-Elite predictions."*
- The Accuracy Dashboard (`AccuracyDashboard.tsx`) shows live, API-sourced `eliteTierBacktest.elite.n` / `nearElite.n` counts computed fresh from the real `evaluation_predictions` corpus every time the dashboard loads.
- `ShadowReplay.tsx` carries a prominent warning banner distinguishing shadow evidence from live trading evidence.
- No page mixes shadow rows into live/backtest accuracy metrics.

**Issue found and fixed:**
`PredictionResult.tsx` hardcoded `n=189` (HIGH CONFIDENCE) and `n=468` (Elite tier) as snapshot counts from when the copy was written. These numbers drift silently as more predictions are graded: if the real counts have grown, showing a smaller stale number understates the evidence; if the corpus has been modified or re-evaluated, any specific hardcoded count is simply wrong.

Since `PredictionResult.tsx` does not call the evaluation dashboard (it only loads a single prediction), the right fix is to remove the specific stale counts and replace them with copy that directs users to the Accuracy Dashboard where live counts are shown.

**File changed:** `artifacts/tennis-predictor/src/pages/PredictionResult.tsx`
- Removed `n=189` from the HIGH CONFIDENCE explanatory paragraph → replaced with "early-stage" and a pointer to the Accuracy Dashboard.
- Removed `n=468` from the Elite tier explanatory paragraph → same pointer.
- Updated the developer comment above `RECOMMENDATION_LABELS` to explicitly note that hardcoded snapshot counts must not be re-introduced here.

---

## Area 3 — DQ Miscalibration & Match Load Recovery Determination

### Finding: Both fully resolved. No additional fixes required.

**DQ miscalibration root cause (Task #111):**
The bug was that `index.ts` built one `moduleEdges` array filtered by `EXCLUDED_FROM_ENSEMBLE` (Availability, Fatigue, Match Load Recovery) and then passed that same already-filtered array to `computeDataQuality`. This silently dropped three documented DQ blend modules, causing the DQ score to be driven entirely by Surface Elo / Serve & Return / Recent Form — all sample-count proxies that saturate at high DQ and bias toward deep-draw, harder-to-call matches.

**Fix already applied** (`artifacts/api-server/src/services/predictionEngine/index.ts`):
```typescript
const allModuleEdgesForDataQuality = moduleEdges.filter(
  (m) => !excludedModels?.has(m.key) && !EXCLUDED_FROM_DATA_QUALITY.has(m.key)
);
const ensembleModuleEdges = moduleEdges.filter(
  (m) => !excludedModels?.has(m.key) && !EXCLUDED_FROM_ENSEMBLE.has(m.key)
);
```
`allModuleEdgesForDataQuality` feeds `computeDataQuality` (only Head-to-Head excluded, per its documented rationale).  
`ensembleModuleEdges` feeds `buildEnsemble` (Availability, Fatigue, Match Load Recovery also excluded, per their own ablation results).

Confirmed by code inspection: both arrays are built from the same `moduleEdges` source but filtered independently.

**Validation outcome** (from `audit-task111-dq-degradation-above-55.md`):
The DQ 85-100 band shrank from 422 rows to 96 (−77%) after the fix, meaning far fewer matches now reach an inflated score that the walk-forward data doesn't support. A residual reversal remains (n=96 still shows 49.0% favorite win rate) but that requires a new "quality of competition" signal (not a blend reweight) to resolve fully — documented as a known remaining risk.

**Match Load Recovery determination (Task #96):**
A representative stratified sample ablation (4,001 matches, ~22% of the 18,242-match corpus, proportionally stratified by surface × year) found:
- Overall accuracy: **57.3% with it voting, 57.3% without (delta = 0.0pp)**, n=2,820 scored predictions.
- 83/2,820 predictions (~2.9%) flip when the module is removed; those flips score 50.6% — close to coin-flip — so they roughly cancel out.
- Per-surface/tour deltas are inconsistent in sign on thin slices (Grass n=35, IndoorHard n=227, Junior n=27) and read as noise; the two largest surfaces (Hard n=1,738, Clay n=820) both show ~0.0pp.

**Decision:** `matchLoadRecovery` remains in `EXCLUDED_FROM_ENSEMBLE`. It is computed and shown on every prediction for transparency but does not vote. This matches the same ablation bar Availability was held to (leave-one-out must show positive accuracy delta before inclusion). Documented in `docs/audit-matchloadrecovery-live-revalidation.md`.

**Code change:** None required.

---

## Area 4 — Live/Upcoming Matches Speed

### Finding: No real performance bottleneck. Architecture is already optimal for an external-API dependency.

**Profiled path:** `GET /api/fixtures/upcoming` → `collectUpcomingWindow` → `provider.getUpcomingFixturesRange`.

**Architecture:**
- `collectUpcomingWindow` fetches fixtures in 7-day batches (one range call per batch, not one call per day). In the common case (busy calendar), the first batch satisfies `limit` and the loop exits after **one** provider API call.
- Each call is `Promise.all([fixture fetch, tournament surface map])`, so both run in parallel. The tournament surface map is cached for 24 hours; after the first call, it's sub-millisecond.
- The `TtlCache` caches each distinct `(dateStart, dateStop)` key for 5 minutes (`FIXTURES_TTL_MS`). Repeated page loads within 5 minutes cost <10ms.
- The `bypassCache` flag correctly bypasses the cache read while still writing the fresh value back, so a user-initiated "force refresh" gets new data without invalidating the cache for subsequent normal reads.

**Live match handling (previously a bug — confirmed fixed):**
- Upcoming fixtures are filtered by `event_winner === null` before mapping. Live (in-progress) matches satisfy this filter — they have no winner yet. This is correct.
- `isLive` is set to `scheduledStart !== null && new Date(scheduledStart).getTime() < Date.now()`. An in-progress match has a confirmed start time in the past and no winner — correctly flagged live.
- Live scores use their own separate TTL cache lane (`LIVE_SCORE_TTL_MS = 8s`) so polling never throttles or contends with the 5-minute fixture cache.

**Pagination:**
- `collectUpcomingWindow` collects `offset + limit + 1` fixtures then slices `[offset, offset+limit]`, with `hasMore = collected.length > offset + limit`. This is correct: it pages at the collection level, never fetches more than one extra fixture beyond what's needed to detect `hasMore`.
- Pagination is verified by query parameter (`offset`, `limit`) at the route level (`fixtures.ts`), with a default limit of 50.

**Sparse/off-season case:**
- In the worst case (no matches for 35 days), the loop makes 5 sequential 7-day provider calls before returning an empty result. Each call is individually cached. This is intentional and correct — parallel prefetching of all 5 batches would waste provider quota on near-certain cache misses.

**Before/after timing:** On a warm cache (in-process TTL), response time is <10ms. On a cold cache, it is bounded by one provider API round trip (~500ms–1.5s typical for API-Tennis `get_fixtures`). No code change can reduce that cold-path latency without either a longer TTL (which would delay showing new fixture announcements) or a background prefetch job (out of scope for this task). The existing 5-minute TTL is the right tradeoff.

**Code change:** None required.

---

## Summary

| Area | Root cause / status | Code changed |
|---|---|---|
| Shadow replay trustworthiness | Confirmed leak-proof: storage, reporting, and test coverage all correct | None |
| UI honesty for Strong Recommendation / Elite | Stale hardcoded n=189 / n=468 in `PredictionResult.tsx` — fixed to direct users to Accuracy Dashboard | `PredictionResult.tsx` |
| DQ miscalibration | Bug fixed (Task #111): `allModuleEdgesForDataQuality` now separate from `ensembleModuleEdges` in `index.ts` | Already applied; no new change |
| Match Load Recovery | Conclusively excluded: 0.0pp delta on n=2,820 ablation, documented in `audit-matchloadrecovery-live-revalidation.md` | Already applied; no new change |
| Live/upcoming matches speed | No bottleneck: batch range calls, TtlCache with bypass, live match filter correct, pagination correct | None |

## Remaining risks (not fixed by this task)

- **DQ residual reversal at top band (n=96, 49.0%)**: The DQ fix reduced the inflated-high band dramatically but could not eliminate the underlying selection effect (extensively-logged matchups skew toward harder tour-level contests). Resolving this requires a new "quality of competition" module (e.g. ranking parity), not further blend reweighting.
- **Match Load Recovery future revisit**: If the historical corpus grows substantially (e.g. 2x), the ablation should be re-run — a 2-6pp standalone signal on n=2,820 is within the noise range; a larger corpus might surface a real surface-specific edge.
- **Elite tier / HIGH CONFIDENCE backtest counts**: These are now shown live on the Accuracy Dashboard rather than hardcoded. But the underlying evaluation corpus (`historical_test` + `paper_trade`) is still small — neither tier has a statistically significant advantage over the non-tier baseline in current data. Future re-evaluation is warranted once the graded corpus grows.
