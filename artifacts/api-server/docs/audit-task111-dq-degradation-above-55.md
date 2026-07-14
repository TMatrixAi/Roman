# Task #111: Root cause of Data Quality miscalibration above DQ~55

## Background

Task #75 found that, after Task #68 excluded Head-to-Head from the Data Quality (DQ) blend, DQ
stopped tracking real trustworthiness above roughly 55 -- the top DQ 85-100 band was actually the
*worst*-calibrated slice in the whole corpus. That task retuned three downstream consumer
thresholds (`calibration.ts`, `recommendation.ts`, `eliteTier.ts`) as a documented stopgap and
explicitly left the root cause inside `dataQuality.ts`'s blend itself unresolved (see
`audit-task75-dq-threshold-revalidation.md`, "What this does not fix"). This task investigates that
root cause.

## Method

Read-only analysis against the existing DB (no fresh walk-forward re-run, to avoid the ~8-12 minute
wipe-and-regenerate cost for a diagnosis pass). Same out-of-sample corpus definition as Task #75:
`historical_test` rows with `segment==="test"`, plus all `paper_trade`/`live` rows, graded and
`includedInAccuracy===true`. n = 4,111. New reusable diagnostic script:
`src/scripts/auditDQModuleDegradation.ts`.

## Finding A: the real Data Quality blend was silently missing three of its seven documented modules

`index.ts` builds one `moduleEdges` array and reused it for two different purposes:

```
.filter((m) => !excludedModels?.has(m.key) && !EXCLUDED_FROM_ENSEMBLE.has(m.key))
```

`EXCLUDED_FROM_ENSEMBLE` (Availability, Fatigue, Match Load Recovery) exists to keep those three
out of the ensemble **vote** -- each failed its own leave-one-out/ablation bar for voting accuracy,
which is a real, separately-documented decision. But the Data Quality blend call
(`computeDataQuality(moduleEdges.filter(...))`) read from that *same, already-filtered* array. So
in the real, running engine, the DQ blend only ever received Surface Elo, Serve & Return, and
Recent Form (Head-to-Head is separately, deliberately excluded via `EXCLUDED_FROM_DATA_QUALITY`) --
despite `MODULE_IMPORTANCE` in `dataQuality.ts` documenting real weights and rationale for
Availability (0.9), Fatigue (0.7), and Match Load Recovery (0.4), as if they were included. This
is confirmed by recomputing DQ from the raw per-module reliabilities stored in each row's
`featureSnapshot.engine`: a blend using only the three ensemble-voting modules reproduces the real
stored `dataQuality` value exactly (0 / 4,111 rows differ by more than 1 point); a blend that also
includes the three excluded modules does not match the stored value at all.

## Finding B: why the missing three modules specifically break calibration *above* DQ~55

Surface Elo/Serve & Return/Recent Form's `reliability` formulas are effectively proxies for "how
much logged match history exists for this matchup" (sample-count based). Per-DQ-bucket averages of
these three (from `auditDQModuleDegradation.ts`, Finding 1) climb steeply and mostly saturate by the
top DQ band (Recent Form 99.8, 100%-at-cap; Serve & Return 92.5, 84%-at-cap; Surface Elo 79.3,
gradual). Matches where both players are extensively logged skew heavily toward deeper,
more-competitive tournament levels: the same audit found the DQ 85-100 band was 91% non-ITF
(Challenger/Masters 1000/tour-level) vs. 15% for DQ 0-20, and average surface-sample depth rose from
~1 match to ~10.6. Deeper draws between comparable pros are intrinsically *harder* to call
correctly, not easier -- so a DQ blend built only from sample-richness proxies rewards exactly the
population where real accuracy is structurally worse, while the model's own confidence margin from
50% *increases* with DQ (9.2 -> 12.4) over the same range. A decile-level check of each of these
three modules' own directional hit rate against its own reliability found no clean monotonic or
threshold relationship for any of them individually (accuracy oscillates ~51-63% across the full
reliability range for all three) -- ruling out "one module's formula is simply wrong" as the
explanation. Availability, Fatigue, and Match Load Recovery are not subject to the same effect:
Fatigue and Match Load Recovery use fixed-constant reliability (70, identical at every DQ level, so
they can only dampen/dilute, never bias by bucket), and Availability's own reliability rises far
less steeply with DQ (50.7 -> 62.3 across the same range) than the three saturating modules.

## Fix adopted

Restore the documented behavior: the Data Quality blend now draws from every module not in
`EXCLUDED_FROM_DATA_QUALITY` (still just Head-to-Head), independent of `EXCLUDED_FROM_ENSEMBLE`.
Concretely, `index.ts` now builds two derived views of the same `moduleEdges` array --
`ensembleModuleEdges` (unchanged filtering, feeds `buildEnsemble`) and
`allModuleEdgesForDataQuality` (only `excludedModels`/`EXCLUDED_FROM_DATA_QUALITY` applied, feeds
`computeDataQuality`) -- so Availability/Fatigue/Match Load Recovery's real reliability finally
reaches the blend they were always documented to be part of, while ensemble voting weight and each
module's own displayed reliability/probability are completely untouched. No new constants or caps
were introduced; this is a bug fix restoring existing documented intent, not a new heuristic.

Re-running the same 4,111-row corpus with the fix applied (`_tmpValidateDQFix3.ts`, ad hoc, not
retained):

| DQ bucket | Before (buggy, real stored value) n / favWinRate | After (fixed) n / favWinRate |
|---|---|---|
| 0-20 | 861 / 57.4% | (folds into 25-45+ once Availability/Fatigue dilute the low end) |
| 25-45 | 621 / 59.4% | 1,574 / 58.4% |
| 45-55 | 329 / 62.3% | 532 / 59.0% |
| 55-65 | 515 / 56.9% | 665 / 58.2% |
| 65-85 | 960 / 55.8% | 1,244 / 54.7% |
| 85-100 | **422 / 51.7%** | **96 / 49.0%** |

The worst-affected top band shrinks from 422 rows to 96 (-77%) -- far fewer matches now reach a DQ
score the walk-forward data doesn't support, because Availability's genuinely-slower-climbing
reliability (and Fatigue/Match Load Recovery's flat 70) now dilute the three saturating modules
instead of being silently absent.

## What this does not fix (residual, documented)

The reversal is **not** fully eliminated -- the shrunken 85-100 band (n=96) still shows a
worse-than-expected 49.0% favorite win rate. Diluting the blend reduces how many matches can reach
an inflated score, but it cannot correct the underlying selection effect: extensively-logged
matchups are still disproportionately close, tour-level contests that are genuinely harder to call,
and no module currently measures "quality of competition" (e.g. ranking parity between the two
players) as distinct from "amount of logged history." Fully resolving the residual reversal needs a
new signal of that kind, not further reweighting of the existing sample-count-based modules -- see
the proposed follow-up task.

## Downstream thresholds: intentionally left unchanged

Task #75's three retuned constants (`calibration.ts` full-trust anchor at DQ 55/ceiling 0.85,
`recommendation.ts` STRONG_RECOMMENDATION gate at `dataQuality>=45`, `eliteTier.ts`
`ELITE_DATA_QUALITY_THRESHOLD=55`) are **not** changed by this fix. This fix only pulls down
previously-inflated high scores (via genuine dilution, not a cap) -- it does not change what a
score in the low/mid range means, which is what those thresholds gate on. Re-validating them again
without a fresh walk-forward run confirming the new score distribution's calibration at each
existing gate would not be well-supported by data; if a future change further reshapes the DQ
distribution, those thresholds should be walk-forward-revalidated at that time, following Task
#75's method.
