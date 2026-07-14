# Task #75: Re-validating confidence/Elite-tier thresholds after Task #68's Data Quality change

## Background

Task #68 excluded Head-to-Head from the numeric Data Quality (DQ) blend in `dataQuality.ts` --
correct, since H2H sits near its reliability floor (~20) for the very common "no prior meetings"
case, and averaging that in dragged scores down for a reason that isn't a real data gap. That
change deliberately left three DQ-tuned constants untouched pending real evidence:

1. `calibrateProbability`'s confidence-shrink curve (`calibration.ts`) -- full trust at DQ 65, floor 0.4.
2. `computeRecommendation`'s DQ gates (`recommendation.ts`) -- `<25` DO_NOT_RECOMMEND, `>=55` required for STRONG_RECOMMENDATION.
3. `ELITE_DATA_QUALITY_THRESHOLD` (`eliteTier.ts`) -- 65.

This task re-ran a full walk-forward evaluation on top of Task #68's change and checked all three
against the real, post-fix DQ distribution.

## Method

Ran `POST /api/evaluation/walk-forward/run` (fresh 4-fold walk-forward re-fit; this wipes and
regenerates `evaluation_predictions`/`evaluation_runs`). Analyzed the union of genuinely
out-of-sample rows: `historical_test` rows in the `test` segment, plus all `paper_trade`/`live`
rows -- graded, accuracy-eligible, with a full engine snapshot. n = 4,111.

`dataQuality` is read from the frozen `featureSnapshot.dataQuality` (denormalized copy of
`EngineOutput.dataQuality` at scoring time). All rows in this corpus are
`phase9-fixed-ensemble-v2` -- i.e. already reflect Task #68's exclusion.

Two calibration views were used throughout:
- **Favorite-oriented gap**: `favorite win rate (actual) - avg stated confidence`, where stated
  confidence is `max(calibratedProbability, 100 - calibratedProbability)`. Negative = overconfident.
- **Log loss** on the raw `calibratedProbability` vs. actual outcome (0.693 = coin-flip baseline).

## Finding 1: DQ no longer predicts calibration quality the way the old anchors assumed

| DQ bucket | n | favorite win rate | avg stated confidence | gap | log loss |
|---|---|---|---|---|---|
| 0-20 | 861 | 57.4% | 59.2% | -1.8 | 0.677 |
| 20-25 | 403 | 58.1% | 58.0% | 0.0 | 0.672 |
| 25-45 | 621 | 59.4% | 58.8% | +0.7 | 0.670 |
| **45-55** | 329 | 62.3% | 59.7% | **+2.6** | **0.662** |
| 55-65 | 515 | 56.9% | 59.8% | -2.9 | 0.693 |
| 65-85 | 960 | 55.8% | 60.4% | -4.6 | 0.683 |
| 85-100 | 422 | 51.7% | 62.4% | **-10.7** | **0.719** |

The best-calibrated band in the entire distribution is 45-55, not the top end. Calibration gets
monotonically *worse* as DQ climbs past ~55, and the 85-100 band is worse than a coin flip.

## Finding 2: The effect survives controlling for every other Elite gate

Isolating DQ from the other Elite-tier gates (all 3 primary signals agree + calibrated margin >=5,
n=3,014 -- the two other numeric Elite requirements) still shows the same reversal:

| Slice | n | favorite win rate | avg confidence | gap | log loss |
|---|---|---|---|---|---|
| DQ >= 65 | 1,057 | 57.7% | 63.3% | -5.6 | 0.691 |
| DQ < 65 | 1,957 | 60.3% | 61.4% | -1.1 | 0.670 |

And the currently-computed Elite tier itself (`isEliteTier`, all gates applied) is the single
worst-performing slice in the whole corpus:

| Slice | n | favorite win rate | avg confidence | gap | log loss |
|---|---|---|---|---|---|
| Elite (current, DQ>=65) | 267 | 57.3% | 68.5% | -11.2 | 0.715 |
| Non-Elite | 3,844 | 57.1% | 59.1% | -2.0 | 0.680 |

Elite-tier predictions state far higher confidence (68.5% vs. 59.1%) for essentially the same
realized accuracy (57.3% vs. 57.1%) -- i.e. post-#68, requiring high DQ for "Elite" buys nothing
and actively produces the least-calibrated group in the system.

## Conclusion and changes made

Raising any of these three DQ thresholds further would only select a *more* overconfident group,
since the relationship is now monotonically inverted above ~55. All three were moved down to where
the real data actually supports added trust, rather than left at their old (now counter-productive)
anchors:

- `calibrateProbability`: full-trust anchor moved from DQ 65 to DQ 55; the ceiling itself was also
  lowered from 1.0 to 0.85, since even the best band (45-55) wasn't perfectly calibrated. Floor
  (0.4) unchanged -- DQ<20 showed no evidence either way.
- `computeRecommendation`'s STRONG_RECOMMENDATION gate: `dataQuality>=55` -> `dataQuality>=45`, to
  include the 45-55 band (the best-calibrated slice) instead of the worse 55-65 band it let through
  before. `DO_NOT_RECOMMEND`'s `dataQuality<25` floor is unchanged -- the 0-25 range showed no
  meaningful calibration problem in this data.
- `ELITE_DATA_QUALITY_THRESHOLD`: 65 -> 55 (Data Quality's own "Acceptable" floor), so Elite tier
  stops rewarding the specific regime (DQ>=65) shown above to be the least trustworthy one.

## What this does not fix

Data Quality, as currently computed, is no longer a reliable *ordinal* signal above ~55 for this
engine version -- pushing scores up (via #68's fix or any similar future change) does not track
"more real information," at least not post-#68. That is a deeper property of `dataQuality.ts`'s
module blend, not something a threshold retune on the consuming side can correct, and is out of
scope for this task.
