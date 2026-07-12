# Task 23 — Tightening upset-risk thresholds using real outcomes

## Problem

`computeUpsetRisk` gated its two best labels (LOW, MODERATE) behind an exact match on
`modelAgreement` (`Strong`, or `Strong`/`Moderate`), and forced `HighDisagreement` straight to
`EXTREME` regardless of how lopsided the real favorite margin was. In practice this meant any
prediction that didn't land on the single best agreement bucket collapsed into HIGH or EXTREME
even when the underlying margin was genuinely low-risk, which is the "clusters at HIGH/EXTREME"
symptom this task set out to fix.

## What real data was available to tune from

- Live paper-trading (`evaluation_predictions`, `runKind = 'paper_trade'`): checked live, all 111
  rows have `featureSnapshot = null` and none are graded (`actualWinnerId` never set). There is
  currently no real graded outcome with a stored model-agreement value anywhere in the system.
  Production paper trading isn't running on a schedule yet (task #12), so this can't be fixed by
  waiting -- it needs either #12 landing or manual accumulation.
- Walk-forward historical backtests (`runKind = 'historical_test'`): real, regenerated
  out-of-sample rows (8,279 in the run used for this analysis). But `scoreHistoricalMatch` (the
  function walk-forward uses) is a reduced single-model reconstruction that never computes
  `modelAgreement` -- that field only exists in the full live ensemble (`ensemble.ts`). So
  walk-forward can support **margin-vs-outcome** tuning but not **agreement-vs-outcome** tuning.
  Unifying the two is tracked separately by task #9.

## Margin thresholds: real data behind the new cutoffs

Cumulative real upset rate by favorite margin (out-of-sample, `includedInAccuracy = true`):

| margin >= | upset rate |
|---|---|
| 0  | 43.5% |
| 8  | 38.3% |
| 18 | 31.2% |
| 30 | 21.6% |

Non-cumulative bands (clearer view of where the real risk actually breaks):

| band | upset rate | assigned tier |
|---|---|---|
| 0-8   | ~46-51% | EXTREME |
| 8-18  | ~38-46% | HIGH |
| 18-30 | ~31-38% | MODERATE |
| 30+   | ~17-25% | LOW |

Real upset rates never get very low even at high margins (~17-25% at margin 30-50) -- tennis is
inherently high-variance, so LOW means "meaningfully below baseline," not "rare." The middle band
(8-30) is a broad, somewhat noisy plateau rather than a sharp cliff, so 18 is a defensible midpoint
rather than a hard discontinuity in the data. These numeric cutoffs (30/18/8) are unchanged from
before -- they already matched the real data reasonably well. What was broken was the *agreement
gating* layered on top of them (see below).

## What changed: agreement is now a capped modifier, not a hard gate

Since there's no real outcome data to derive an agreement-based cutoff from, `modelAgreement` is
kept as a real but modest, honestly-labeled modifier rather than an invented threshold:
`HighDisagreement` now nudges the margin-derived tier one step worse (never more, never a jump
straight to EXTREME), and `Strong`/`Moderate`/`Mixed` no longer gate LOW/MODERATE at all.

Quantified effect on the regenerated walk-forward test rows, comparing old vs. new logic under two
assumed agreement values (walk-forward doesn't compute real agreement, so both bounds are shown):

- Assumed `Strong` (agreement's old best case): identical under both -- LOW 3.8%, MODERATE 7.1%,
  HIGH 32.1%, EXTREME 57.0%. (Confirms the margin cutoffs themselves didn't need to change.)
- Assumed `Moderate` (a common real-world case): **old** code produced 0% LOW (any margin>=30
  prediction fell through to MODERATE just because agreement wasn't exactly `Strong`) vs. **new**
  code correctly restoring the full 3.8% LOW share, with the difference coming out of MODERATE
  (10.9% -> 7.1%). HIGH/EXTREME are unaffected in this case since Moderate never escalates.

The remaining HIGH/EXTREME-heavy shape of the real distribution (57% EXTREME even under `Strong`)
is a genuine, real-data-grounded finding, not an artifact of the labeling logic: the walk-forward
test segment's real favorite margins are heavily concentrated near a coin flip (median 7.2, p75
11.2, p90 20), largely due to a heavily-shrunk calibration model. That's an accurate reflection of
current prediction confidence, not something upset-risk labeling should paper over.

## Explicitly out of scope

- The calibration shrink curve itself (already tuned in a prior task).
- Deriving a real agreement-vs-outcome threshold -- blocked on task #9 (unifying backtests with
  the full engine) or on task #12 (turning on scheduled paper trading) producing enough graded,
  snapshotted live predictions to analyze.
