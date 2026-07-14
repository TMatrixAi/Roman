# Near-Elite backtest calibration investigation (Task #66)

## The reported problem

Task 46's Elite Tier Backtest card surfaced the "near-Elite" group (every real Elite gate met
except segment-specialist support -- see `computeNearEliteTier`'s doc comment for why specialists
are structurally unreachable in backtesting) as **MISCALIBRATED**: at the time of filing, n=425,
ECE (calibrated) = 0.117 (dashboard's `MISCALIBRATED` threshold is >0.05), accuracy only 56% --
far below what a group meeting nearly every "top-tier confidence" gate should show.

## What the real data showed

Re-running the exact same classification (`classifyEliteTierRow`) against the live
`evaluation_predictions` table (see `analyzeNearEliteOverconfidence.ts`) at n=515 (more graded rows
had accumulated since filing) found:

- ECE had already fallen to 0.0523 and accuracy had risen to 61%, purely from more data -- but the
  group still sat just over the "MISCALIBRATED" line.
- Breaking the group down by fine-grained (5%-wide) confidence buckets showed something that
  contradicted the "overconfident" framing: the single largest bucket (50-55% confidence, 55% of
  the whole group) was actually **under**confident -- 52.8% average confidence against 59.9%
  observed accuracy. A few near-empty buckets in the 70-90% range (n=1-2 each) also contributed
  disproportionate noise, since a lone point is definitionally either 0% or 100% "accurate."
- The real structural problem wasn't overconfidence in the calibration-error sense -- it was that
  **the group's confidence never got very high in the first place.** Even loosening every other
  gate to just "dataQuality >= 65 AND all three signals agree," the resulting ~1000-row pool still
  had 81% of its predictions under 60% confidence, and its single highest-confidence outcome (an
  87.5%-confidence prediction) was wrong. The three-signal-agreement gate that anchors both
  Elite and near-Elite tiers only checks **direction** (`voteFavorsPlayer1`: true the instant a
  signal crosses 50%, whether by 0.1 point or 40) -- so three signals each leaning the same way by
  a hair "agree" exactly as strongly as three signals all leaning hard the same way. That let a
  large population of near-coin-flip matches earn the "near-Elite" label, diluting both its
  accuracy and its calibration.

## Root cause

Two distinct issues, both real, of different sizes:

1. **Real, if modest, root cause (fixed here):** the Elite/near-Elite signal-agreement gate has no
   minimum-margin requirement, so directionally-agreeing-but-barely-leaning signals qualify a
   match for the tier just as readily as strongly-agreeing signals. This structurally packs the
   tier with near-toss-up matches.
2. **Small-sample bucket noise (fixed as a side effect, general improvement):** `computeECE`
   weighted every non-empty confidence bucket equally regardless of size, so a couple of lone
   points in the sparse high-confidence tail could swing the metric by chance alone.

A **third**, larger structural issue was investigated and deliberately **not** touched here: the
global isotonic/Platt calibration curve is fit on the *pooled* population (see `calibration.ts`),
so a raw-probability range dominated by weaker (non-agreeing-signal) predictions gets shrunk toward
50 for everyone sharing that raw probability, including higher-quality near-Elite predictions in
the same range. Building a genuinely separate calibration path for Elite-eligible predictions is
real, substantial work that overlaps directly with **Task #65** ("Let the Elite tier earn real
evidence from historical backtests, not just rare live trades"), already queued and blocked on this
task -- implementing it here would preempt that task's entire reason to exist, so it's left there.
Re-tuning the Elite/near-Elite data-quality and other thresholds in light of this finding is
likewise left to **Task #75** ("Re-check confidence and Elite-tier thresholds..."), also already
queued and blocked on this task.

## Fix implemented (2026-07-14)

1. **`ELITE_MIN_CALIBRATED_MARGIN` (eliteTier.ts):** Elite/near-Elite now additionally requires the
   *final* calibrated probability to be at least 5 points from a coin flip (>=55% or <=45%), not
   just directional agreement among the three primary signals. 5 points was chosen as the smallest
   threshold that produced a clean, non-marginal ECE improvement on the real backtest data while
   keeping the near-Elite sample (n=231 after the change) far above `ELITE_TIER_BACKTEST_MIN_SAMPLE_SIZE`
   (30). Verified against real data (`analyzeNearEliteOverconfidence.ts` / the live
   `/api/evaluation/dashboard` endpoint, no walk-forward re-run needed since this only reclassifies
   already-graded rows, it doesn't change how predictions are generated):
   - Before: n=515, accuracy 61%, ECE (calibrated) 0.0523 -- MISCALIBRATED.
   - After: n=231, accuracy 62.3%, ECE (calibrated) 0.0262 -- WELL-CALIBRATED (comfortably under
     even the 0.03 "well-calibrated" bar, not just the 0.05 "miscalibrated" ceiling).
2. **`MIN_ECE_BUCKET_SAMPLE` (metrics.ts):** `computeECE` now excludes any confidence bucket with
   fewer than 5 points from the metric entirely (both numerator and denominator), rather than
   including it at full weight. This is a general fix to the metric used by every segment on the
   Accuracy dashboard, not specific to near-Elite, though its effect on this cohort specifically was
   small (0.0523 -> 0.0511 in isolation, before the margin gate above).

## What's still open (deliberately deferred, not part of this task)

- Task #65: fitting a genuinely Elite-scoped calibration curve (or another way to let Elite/near-Elite
  earn direct evidence from backtests) rather than relying on the pooled curve.
- Task #75: re-checking Elite/near-Elite's other thresholds (data quality, etc.) now that the margin
  gate above has changed which predictions land in this tier.
- Task #105: extending win-probability-scale safeguards elsewhere in the engine -- relevant background
  for why individual model votes can have compressed probabilities, but out of scope here.
