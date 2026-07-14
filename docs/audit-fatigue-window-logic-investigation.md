# Fatigue Window-Logic Investigation

Date: 2026-07-14
Scope: Task 89 — investigate why Fatigue scored 45.6-45.8% conditional accuracy (below a coin
flip) once its backtest `asOfDate` bug was fixed, and decide whether to fix its window/weighting
logic or keep it excluded from the ensemble vote.

## 1. Background

Fatigue was excluded from `EXCLUDED_FROM_ENSEMBLE` on 2026-07-14 as a stopgap after a full
walk-forward re-run showed only 45.6-45.8% conditional accuracy while carrying ~16.5% ensemble
weight in the 48-59% calibration band. That re-run was itself only possible after a separate fix
earlier the same day: Fatigue's 3/7/14-day windows had been measured against `Date.now()` during
backtests instead of each historical row's own frozen `cutoffAt`, so the module silently voted a
flat 50/50 on the entire backtest corpus and its real accuracy was invisible until then.

## 2. Methodology

A prior walk-forward run already populated `evaluation_predictions` (`run_kind = 'historical_test'`)
with real per-match `featureSnapshot.engine.fatigue` output (both players' fatigue scores) even
though Fatigue is excluded from the ensemble vote itself -- excluded modules are still fully
computed and stored for transparency (see `EXCLUDED_FROM_ENSEMBLE`'s doc comment). This
investigation queried that already-stored data directly rather than re-running the full
walk-forward pipeline, which would have wiped `evaluation_runs`/`evaluation_predictions` and
refit the live-active calibration model as a side effect -- unnecessary and unsafe for an
investigation that only needs Fatigue's own isolated signal, not a fresh end-to-end scoring pass.

Dataset: 7,321 real historical matches with `includedInAccuracy = true`, a resolved actual winner,
and a non-tied fatigue score gap between the two players (out of 8,275 total rows with fatigue
data; ties and voided/excluded rows are dropped since they carry no directional signal to test).

## 3. Findings

**Naive "less-fatigued player wins" accuracy, by score gap:**

| Minimum gap | n | Accuracy |
|---|---|---|
| >0 (any) | 7,321 | 45.14% |
| ≥10 | 4,760 | 41.74% |
| ≥20 | 2,762 | 40.01% |
| ≥30 | 1,660 | 39.34% |
| ≥40 | 991 | 38.35% |

Accuracy doesn't hover near 50% regardless of gap size (the signature of pure noise) -- it gets
**monotonically worse** as the gap widens. That pattern is the signature of a real, systematic
relationship that's pointing the wrong way, not random noise.

**Direct confirmation of inversion:** across all 7,321 decided matches, the MORE "fatigued"
player actually won **54.85%** of the time (4,016/7,321) -- not the less-fatigued one. At the
widest gaps (≥40) that inverts to roughly 61.65% in the more-fatigued player's favor.

**Root cause -- survivorship/momentum confound:** the 3/7/14-day windows count total recent
matches (win or loss), weighted more heavily for very recent ones (`last3*3 + ...`). In real tour
scheduling, playing many matches in a short window overwhelmingly means a player has been
**winning and advancing** through a draw, not accumulating fatigue -- a player who loses exits
that event and stops accumulating "recent matches." This was tested directly: when there's a
fatigue-score gap, the more-fatigued player is also the one favored by the separately-computed,
win-rate-based Recent Form module **61.5%** of the time (4,108/6,684 comparable cases, comfortably
above chance). Fatigue's match-count formula is measuring recent winning momentum -- a signal
Recent Form already captures on purpose -- mislabeled and negatively signed as "tiredness."

**By surface:** Hard 45.55% (n=4,479), Clay 44.34% (n=2,368), IndoorHard 48.57% (n=350), Grass
36.29% (n=124, small sample). The inversion is broad-based, not isolated to one surface.

**By ensemble calibration band:** 44.34%-48.22% across the 48-70% bands (70%+ band has only
n=33, too small to trust). No band clears 50% either.

## 4. Why a sign-flip isn't a real fix

Given the accuracy inverts, the obvious tempting patch is to flip the ensemble's edge formula so
higher recent match count favors that player instead of penalizing them. That was considered and
rejected: since the "more fatigued" player already agrees with Recent Form's pick 61.5% of the
time, a flipped Fatigue vote would mostly be re-emitting Recent Form's own signal under a
different module name. The ensemble's weighting model treats each module as contributing
roughly-independent information; stacking two positively-correlated votes for the same underlying
effect (recent winning momentum) would double-count it and inflate the ensemble's combined
confidence without adding real incremental accuracy. That's a worse outcome than leaving the
module excluded, even though the isolated flipped-Fatigue accuracy number would look better.

## 5. Decision

**Fatigue remains excluded from the live ensemble vote, now permanently rather than "pending
investigation."** The window/match-count formula as designed cannot honestly distinguish physical
tiredness from tournament-survivorship momentum, and that isn't a bug fixable by adjusting window
sizes or weights -- it's a construct-validity problem in what the signal measures. `dataQuality.ts`'s
`EXCLUDED_FROM_ENSEMBLE` comment has been updated with this conclusion and the numbers above.
Fatigue's raw outputs (scores, match/game counts) remain fully computed and shown in
`EngineBreakdown` for transparency, same as before -- only its ensemble vote stays withheld.

A genuine fix would require a redesigned feature that isolates true tiredness -- e.g. a
quick-turnaround/back-to-back-match indicator (matches within ~24-48h of each other) combined with
long-match indicators (3-set marathons), explicitly decorrelated from win/loss outcome so it
can't just re-derive "currently winning" -- and would need its own independent walk-forward/
ablation validation (the same bar Availability was held to) before earning a spot in the ensemble.
That redesign is real feature-engineering work, not a bug fix, and is scoped as a separate
follow-up task rather than attempted here.

## 6. What changed in code

Only `EXCLUDED_FROM_ENSEMBLE`'s doc comment in `dataQuality.ts` was updated to record this
concluded root cause and permanent-exclusion decision. No scoring logic changed: Fatigue was
already excluded from the ensemble vote before this investigation and remains excluded after it --
behavior for live/paper-trading/backtest predictions is unchanged. `fatigue.ts`'s window/weighting
formula itself was intentionally NOT modified, since no arithmetic or window-boundary bug was
found (the 2026-07-14 `asOfDate` fix already addressed the one real bug in this module); the
finding here is a measurement-validity issue in the underlying feature design, addressed by
keeping the module out of the vote rather than by patching its formula.
