# Task #157: Did the Task #151 confidence-discount fixes actually close the gaps?

**Date:** 2026-07-15
**Method:** Fresh ablation report generated against the CURRENT engine code (i.e. with Task #151's
three fixes live), via `POST /api/evaluation/ablation/run` with `sampleSize=4000` (a stratified
sample by surface+year -- a full-corpus run over the current 130k-match corpus would not complete
without exhausting the dev server's default heap; see "Infra note" below).
Report: `reports/model-ablation-analysis-task157-postfix.json` /
`reports/model-ablation-analysis-sampled.json` (same content, the latter is the canonical
"most recent sampled run" path other tooling reads).

**Important confound:** the historical corpus grew from ~18.2k eligible matches (2026-07-13/14,
when Task #151's evidence was gathered) to **130,304** eligible matches now (now spanning into
2026), because the historical-backfill job kept running in the background. The overall pool
accuracy moved from 57.3% to 61.6% between the two reports. That shift is real new data, not the
Task #151 fixes -- none of the three fixes change which player is picked (only how confident the
stated probability is), so they cannot move raw pick accuracy on their own. This means the
before/after *raw accuracy* numbers below are NOT a clean isolated measurement of the fixes; they
are the best available fresh read given how much real data has now accumulated, same as the task
asked for ("once enough new real predictions/evaluation data has accumulated").

## 1. Data Quality inversion (calibration.ts) -- CLOSED, direction now correct

| | 2026-07-13 report (n=13,066) | 2026-07-15 fresh report (n=3,191) |
|---|---|---|
| DQ >= 65 ("high") | 56.0% (n=2,398) | **62.5%** (n=1,987) |
| DQ < 65 ("low") | 57.6% (n=10,668) | **60.1%** (n=1,204) |
| Gap | high is 1.6pts WORSE | high is 2.4pts BETTER |

The specific harm the fix targeted -- confident-looking (high-DQ) predictions being *less*
accurate than low-DQ ones -- is gone; the direction has flipped to the expected one (more data
generally means a more trustworthy prediction).

**Recommendation: leave the decay curve as-is, do not loosen it yet.** The new high-DQ segment
now looks strong enough that one might be tempted to raise the confidence factor back up past
DQ 65. Two reasons not to, both already documented as house lessons:
- The corpus composition changed substantially (7x larger, now includes 2026 matches) in the same
  window as this measurement -- we can't yet tell how much of the swing is "the fix worked" vs.
  "this is a different, newer slice of data with different characteristics."
- `data-richness-vs-matchup-difficulty.md` (project memory): sample-count-based reliability
  modules structurally can't distinguish "well-logged" from "genuinely easy to call" -- a single
  ablation snapshot's accuracy number is not enough evidence to re-inflate trust in high-DQ
  matches. A real walk-forward re-fit (not an ablation replay) is the right instrument for that
  decision.

## 2. ATP tour discount (`TOUR_RELIABILITY_DISCOUNT.ATP = 0.63`) -- gap persists, size not

| | 2026-07-13 (n=1,242) | 2026-07-15 (n=231) |
|---|---|---|
| ATP accuracy | 54.6% | 58.0% |
| Pool accuracy | 57.3% | 61.6% |
| Gap ratio `(ATP-50)/(pool-50)` | 0.63 | 0.69 |

ATP still measurably underperforms the pool in the fresh sample -- the underlying problem this
discount corrects for has not gone away. The ratio moved from 0.63 to 0.69 (i.e. slightly less
severe), but `n=231` in the stratified sample is far too small (vs. 1,242 before) to treat that
6-point ratio shift as a real re-tuning signal rather than noise.

**Recommendation: keep `TOUR_RELIABILITY_DISCOUNT.ATP = 0.63` unchanged.** The gap is real and in
the same direction; re-tuning off a 231-match noisy sample would replace a documented,
larger-sample-backed constant with a worse-evidenced one.

## 3. Low-surface-sample discount (`LOW_SURFACE_SAMPLE_DISCOUNT = 0.75`) -- inconclusive, too thin to act on

The original evidence was Surface Elo/Fatigue/Availability's largest leave-one-out swing landing
on Grass (-1.3/-1.9/-1.9pts, n=162). In the fresh report (Grass n=119, all 2025-2026 matches),
all three of those same leave-one-out deltas on Grass are now exactly 0. That is directionally
consistent with "the noise-sensitivity problem eased," but `n=119` is even thinner than the
already-thin 162 used to justify the fix, so 0.0-point deltas are as likely to be a small-sample
floor effect as a real improvement.

**Recommendation: keep `LOW_SURFACE_SAMPLE_DISCOUNT = 0.75` unchanged.** No adjustment is
justified by this sample size in either direction.

## 4. Active Segment Specialist overconfidence fix (specialistWeights.ts) -- CANNOT BE VERIFIED YET

`specialist_models` has **zero rows** in the current environment (checked directly against the
DB). No walk-forward run has ever called `computeAndStoreSpecialistSegments` since the Task #151
fix (switching `computeOneSegment` to holdout-validated `fitBestCalibration`) landed. Confirmed in
the fresh ablation report: every diagnostic bucket for `segmentSpecialist` shows `n: 0`, and
`combo_specialists_off` produces byte-for-byte identical accuracy to the baseline -- the specialist
has not voted on a single match, fixed or not.

**This part of Task #151 is unverifiable until a walk-forward evaluation run populates
`specialist_models` again.** Deliberately not run as part of this task: `runWalkForwardEvaluation`
wipes ALL prior evaluation history on every call (see `walkforward-historical-scoring-perf`
project memory and open Task #135, "Stop the walk-forward test suite from wiping real evaluation
history when run," still unresolved) -- running it casually here to satisfy a verification task
would destroy real evaluation data for a much larger problem than this task's scope. Filed as a
follow-up (see below) instead of run blind.

## Infra note (side effect of this investigation)

Triggering the ablation job over HTTP against the live dev-server process (as designed) OOM'd the
server at Node's default ~2GB old-space heap limit when scoring a 4,000-match sample across 14
variants against the now-130k-match corpus (the corpus this job holds fully in memory for
Elo/match-history reconstruction has grown 7x since the job's memory footprint was last sized).
Set `NODE_OPTIONS=--max-old-space-size=6144` for the `development` environment so the job (and any
future one, e.g. for Task #134) can complete without crashing the dev server; this does not change
production configuration. The `artifacts/api-server: API Server` workflow was restarted afterward
and is healthy. A dedicated fix for the underlying memory-scaling problem is Task #161 ("Stop
full-corpus evaluation runs from crashing the dev server"), already filed separately.
