# Task #120: Re-evaluating STRONG_RECOMMENDATION's thresholds with live + backtest data

## Background

Task #116's full statistical audit (`audit-task116-full-statistical-audit.md`, run 2026-07-14,
n=4,111 held-out test rows across a 4-fold walk-forward backtest) found that `STRONG_RECOMMENDATION`
-- the tier the UI presents as the engine's most confident, most trustworthy call -- had the
**worst log loss of any recommendation tier (0.736, worse than a coin flip)**, on a small sample
(n=189). The audit explicitly flagged this as "large enough to be a real warning sign" but too
small to justify a specific threshold change on its own, and recommended a dedicated re-validation
once more graded live volume existed (Task #121).

This task re-runs that re-validation using the Task #75 methodology (the precedent for re-tuning a
DQ-gated threshold from real walk-forward evidence), incorporating whatever live data Task #121's
fix has produced, and breaking results down by tournament level.

## What data was actually available for this re-validation

**Live/paper-trading ledger: still zero graded rows.** Task #121's fix is confirmed live and
working -- `paper-trading-cycle` ran successfully during this task (2026-07-14, several runs
between 19:01-19:07 UTC) and has 15 real fixtures currently locked and pending (scheduled
18:15-19:30 UTC today). But none of today's real matches have finished and been graded yet as of
this writing (`graded: 0` on every cycle run), so **there is still no live evidence to compare
against the historical backtest.** This is expected given how recently the pipeline started
capturing again, not a new failure -- but it means this task cannot yet do the live-vs-backtest
comparison its own brief calls for. That comparison should be re-run once live grading volume
exists.

**Historical backtest: the exact n=4,111/n=189 dataset behind Task #116's finding no longer exists
in the database.** Walk-forward runs wipe and regenerate `evaluation_predictions`
(`run_kind='historical_test'`)/`evaluation_runs` on every call (by design, so re-runs don't mix
stale and fresh folds), and a fold had been re-run for a different investigation (Task #128, the
65-70%-band overconfidence probe) between the audit and this task, leaving only a single fold's
worth of data (n=2,293 test rows, only 7 reconstructed `STRONG_RECOMMENDATION` rows -- unusable for
a per-tier breakdown). Attempting a fresh full 4-fold re-run to restore the original sample size
repeatedly hit walk-forward's genuine runtime cost (Task #75-documented 8-12+ minutes for a full
4-fold pass, confirmed again here: ~2-3 minutes per fold, growing with each successive fold's
larger training-history rebuild) against this session's execution constraints. A single fresh fold
(test window 2025-02-26 to 2025-03-11, n=2,079) was completed and used below as an independent
corroborating sample alongside the original audit's numbers -- not a replacement for a full 4-fold
re-run, which should be completed in a follow-up session with more runtime headroom.

## Finding 1: the audit's result reproduces on an independent sample

| Source | n (STRONG_RECOMMENDATION) | Accuracy | 95% CI | Log loss |
|---|---|---|---|---|
| Task #116 audit (4-fold, Feb 19 - Apr 1 2025 test window) | 189 | 60.3% | [53.2, 67.0] | **0.736** |
| This task's fresh single fold (Feb 26 - Mar 11 2025 test window) | 44 | 61.4% | [46.6, 74.3] | **0.729** |

Both independent samples -- different date windows, different fold boundaries, several days apart
in when they were computed -- land in the same place: `STRONG_RECOMMENDATION`'s log loss is worse
than the 0.693 coin-flip baseline, and its point-estimate accuracy is not distinguishable from
`MODERATE_LEAN`:

| Tier | Task #116 audit (n) | Task #116 accuracy | This task's fresh fold (n) | Fresh accuracy | Fresh log loss |
|---|---|---|---|---|---|
| MODERATE_LEAN | 2,231 | 64.3% | 471 | 65.6% | 0.646 |
| HIGH_RISK | 1,632 | 55.7% | 816 | 56.5% | 0.685 |
| **STRONG_RECOMMENDATION** | **189** | **60.3%** | **44** | **61.4%** | **0.729** |
| NO_STRONG_SIGNAL | 1,556 | 51.7% | 748 | 51.7% | 0.690 |

This reproducibility across independent slices raises confidence that the original finding is a
real property of the current engine version, not a one-off artifact of the specific 4-fold split
the audit happened to draw. It does not, on its own, tell us what to change.

## Finding 2: per-tournament-level breakdown is not statistically usable, in either sample

The task brief calls for breaking `STRONG_RECOMMENDATION`'s performance down by tournament level
(Grand Slam, Masters, ATP/WTA tour-level, Challenger, ITF). Attempting this on the fresh fold
(n=44, the largest `STRONG_RECOMMENDATION` sample available in this task) is instructive mainly in
showing why it can't be done responsibly yet:

| Tournament level | n | Correct |
|---|---|---|
| Masters1000 | 23 | 14 (60.9%) |
| ITF | 6 | 3 (50.0%) |
| Challenger | 6 | 4 (66.7%) |
| WTA250 | 6 | 4 (66.7%) |
| ATP500 | 2 | 1 (50.0%) |
| ATP250 | 1 | 1 (100.0%) |
| Grand Slam | 0 | -- |

Every single level has a sample too small for any Wilson interval to be meaningfully narrow (best
case Masters1000 at n=23 still spans roughly 41-78% at 95% confidence), several levels have single
digits, and Grand Slam has zero rows in this window at all. The Task #116 audit's own overall
`STRONG_RECOMMENDATION` sample (n=189) was already flagged as too small to act on standalone; a
tournament-level split of it would only produce ~20-40 rows per level in the best case (given the
tier is itself only ~4.6% of all graded rows) -- still underpowered. **No tournament-level
conclusion can be drawn from currently available data.** This should be revisited once either (a)
a full multi-fold re-run accumulates a larger `STRONG_RECOMMENDATION` sample, or (b) live grading
volume (Task #121) accumulates over weeks/months of real play.

## Finding 3: the better-powered calibration-curve evidence explains why a threshold retune isn't the right lever here

Unlike Task #75 (where DQ-bucketed calibration was cleanly monotonic in the wrong direction and a
lower floor clearly moved the tier into the best-calibrated band), the relevant evidence here is
the confidence-band calibration curve from the Task #116 audit (§2), which has much better power
than the tier-specific reconstruction because it isn't gated on every other `STRONG_RECOMMENDATION`
condition:

| Predicted confidence | n | Observed accuracy | Gap |
|---|---|---|---|
| ~67% | 1,232 | 65.3% | -2pt |
| ~72% (near `STRONG_RECOMMENDATION`'s margin>=22 / confidence>=72% gate) | 307 | 65.1% | **-7pt** |
| ~77% | 136 | 67.6% | **-10pt** |
| ~82% | 54 | 66.7% | -15pt (small-n) |

The overconfidence gap does not shrink as confidence rises past the current gate -- it *widens*
(-7pt at 72%, -10pt at 77%). This is the opposite of Task #75's pattern, where moving the threshold
into a different band produced a clearly better-calibrated segment. Here, raising
`STRONG_RECOMMENDATION`'s margin requirement (e.g. from >=22 to something higher, tightening toward
the 77%+ band) would select an *equally or more* overconfident population, not a better one.
Lowering it would pull in the 60-67% range, which is well-calibrated on its own -- but that range is
already `MODERATE_LEAN`'s territory, and merging it into `STRONG_RECOMMENDATION` would just relabel
already-well-calibrated moderate predictions as "strong" without fixing anything about the
overconfident 70%+ region. **The overconfidence lives in the calibration curve itself
(`calibration.ts`), not in where `recommendation.ts` draws its gate.** A recommendation-tier
threshold change cannot fix a calibration-model problem; it can only choose which mislabeled slice
gets the "Strong" badge.

## Decision: leave STRONG_RECOMMENDATION's thresholds unchanged

No specific alternative value for `margin`, `dataQuality`, `upsetRisk`, or `modelAgreement` in
`computeRecommendation()` is supported by the evidence gathered here:

- The finding reproduces across two independent samples, confirming it's real -- but neither sample
  is large enough, and per-tournament-level breakdown is not viable in either, to support choosing
  a specific new numeric threshold with any confidence.
- The one dataset large enough to be informative (the confidence-band calibration curve, n=307-136
  in the relevant range) shows the overconfidence *worsens* at higher confidence, meaning a tighter
  margin would not select a better-calibrated population the way Task #75's DQ retune did.
- Live data (the other required input per this task's brief) does not exist yet -- Task #121's
  fix is active and correctly capturing new predictions, but zero real matches have completed and
  graded since it started.

This matches the task's explicitly acceptable outcome: leaving current thresholds in place while
clearly documenting why, and what would change that conclusion. A comment was added to
`recommendation.ts` recording this review (mirroring the Task #75 comment already there) so a
future reader doesn't have to rediscover this history.

## What would change this conclusion

1. **Live grading volume** (Task #121's pipeline, now active) accumulating enough graded
   `STRONG_RECOMMENDATION` predictions to check whether real market/live conditions track or
   diverge from the historical pattern found here.
2. **A full multi-fold walk-forward re-run** completed end-to-end (this task's session could not
   fit one in its execution budget) to restore a `STRONG_RECOMMENDATION` sample close to the
   original n=189, ideally larger, so a tournament-level breakdown becomes statistically viable.
3. **Fixing the underlying calibration overconfidence above ~70% confidence** in `calibration.ts`
   (a distinct, deeper fix from Task #128's narrower 65-70%-band investigation) -- once that's
   done, this tier's thresholds should be re-checked again, the same way Task #75 re-checked Elite
   tier and calibration together after Task #68's Data Quality change.
