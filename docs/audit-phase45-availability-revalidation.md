# Phase 45 — Serve/Return, Surface-Sample, and Availability Revalidation

Date: 2026-07-13
Scope: Task 45 — add point-level serve/return inputs, surface per-matchup sample-depth
labeling, rework Availability's inputs (rest buckets, travel buckets, confirmed walkover), and
re-run walk-forward validation to decide whether the reworked Availability module clears the bar
for re-entering the live ensemble vote.

## 1. What changed

- **Serve/Return**: added `PointLevelStats` (first-serve win %, BP saved %, BP converted % via the
  opponent's same-match stat line, service-games-held % via the Newton–Keller closed-form formula
  applied to real `servicePointsWonPct`). Blended into the existing rating with a small (0.2)
  weight only when both players clear a 3-match sample floor. The margin-proxy fallback path is
  unaffected — verified with a dedicated regression test comparing identical proxy-path
  inputs/outputs before and after.
- **Surface sample depth**: `computeSurfaceSampleDepth()` labels the existing Surface Elo
  `sampleSizePlayer1`/`sampleSizePlayer2` as Low (<5) / Moderate / High (≥15), reusing Surface
  Elo's own `5`-match warning threshold. Exposed as a new top-level `surfaceSampleDepth` field on
  `EngineOutput` so low-sample surface predictions are visibly flagged.
- **Availability rework**: added `restCategory` (ShortRest ≤2d / Normal / LongLayoff ≥14d /
  Unknown), `travelBucket` (None / Local ≤800km / Regional ≤4000km / Intercontinental), and a
  confirmed-withdrawal signal that now checks both mid-match retirement AND the real (previously
  unused) `walkover` field — walkover wins when both fire, since a pre-match walkover is the
  stronger, more definitive signal. Added a 0–100 `player1AvailabilityScore`/
  `player2AvailabilityScore`, real-data-only with a neutral 60 baseline when nothing resolves.

All changes are additive/backward-compatible: every pre-existing field and test is unchanged; 12
new tests were added across `serveReturn.test.ts`, `availability.test.ts`, and
`dataQuality.test.ts`. Full `test:predictionEngine` suite: **41/41 passing**.

## 2. Walk-forward validation (4-fold, `POST /api/evaluation/walk-forward/run`)

Run against the live historical corpus with all Task 45 changes active (Availability still
excluded from the ensemble vote at this point, per its prior exclusion):

| Fold | n | Accuracy |
|---|---|---|
| 0 | 995 | 56.6% |
| 1 | 1030 | 57.7% |
| 2 | 949 | 59.4% |
| 3 | 1117 | 59.3% |

Weighted overall: **58.3%** across 4,091 out-of-sample predictions. No crashes, no `NaN`/void
regressions, `missedCount: 0` on every fold. This is consistent with the range this engine has
historically reported (mid/high 50s), so the serve/return point-level blend and surface-sample
exposure did not regress overall accuracy. (No pre-change walk-forward snapshot exists to diff
against directly — this task calls for a single one-time re-validation run, not an A/B — so the
check here is "still in the expected, non-degenerate range with zero errors," not a numeric delta
against a stored baseline.)

## 3. Availability inclusion decision (live ablation replay, full 18,281-match corpus)

The walk-forward run above still had Availability excluded, so it could not measure the value of
*including* the reworked module. Two full ablation replays (`POST /api/evaluation/ablation/run`,
13 variants each) were run to isolate that:

- **Run A** — Availability excluded (as before): baseline overall accuracy **57.4%**. The
  "remove availability" leave-one-out variant is a no-op against this baseline (delta = 0.0),
  since it was already outside the vote — this run cannot answer the inclusion question by
  itself.
- **Run B** — Availability temporarily included in the ensemble (`EXCLUDED_FROM_ENSEMBLE`
  cleared): baseline overall accuracy **57.3%**. Leave-one-out removal of Availability from this
  active baseline gives **57.4%** — i.e. removing it recovers +0.1pt, so including it costs
  -0.1pt overall.
  - By tour: ATP +0.2pt to remove, Challenger -0.1pt, WTA 0.0pt, ITF +0.1pt — no tour where
    inclusion clearly helps.
  - By data quality segment: High-DQ matches -0.2pt to remove (i.e. +0.2pt to include), Low-DQ
    matches +0.2pt to remove (i.e. -0.2pt to include) — a real but small and offsetting split, not
    a case for inclusion overall.

**Decision: Availability remains excluded from the live ensemble vote.** The reworked inputs
(rest buckets, travel buckets, confirmed walkover) did not clear the "net positive accuracy
delta" bar the task set for re-inclusion — the effect is flat to slightly negative (-0.1pt
overall). `EXCLUDED_FROM_ENSEMBLE` in `dataQuality.ts` keeps `"availability"`, with the specific
numbers above in its code comment. `ENSEMBLE_WEIGHT_PRIOR.availability = 0.4` is left in place as
a ready-to-use prior for if a future rework clears the bar — it is inert while excluded.

Availability's outputs (rest/travel buckets, availability scores, confirmed-withdrawal
disclosure) remain fully computed and shown in `EngineBreakdown` for transparency; only its vote
in the blended probability is withheld.

## 4. Why this needed two separate ablation runs

The ablation harness's leave-one-out variants ablate *from the current baseline configuration*.
Because Availability was already in `EXCLUDED_FROM_ENSEMBLE`, its "removed" variant against the
default baseline was mathematically identical to the baseline itself (delta = 0), which looks
like "no measurable effect" but actually just means "already off." Answering "should this be
turned on" requires flipping the baseline itself to include it, then re-measuring — that's Run B
above. Worth remembering for any future re-validation of an already-excluded module.
