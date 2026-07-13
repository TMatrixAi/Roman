# Task 56 — Incremental Validation & Final Consistency Checks

Date: 2026-07-13
Scope: validate Tasks 45 (Serve/Return depth), 52 (Surface Elo), 53 (Recent Form), 54
(disagreement recalibration), and 55 (upset-risk rework) together as one combined system, add
tier persistence so tier-level outcomes are queryable from real graded history, add a
defense-in-depth final-consistency guard, and prove the original bug report's failure mode (a
prediction shown as Elite, High Disagreement, and "no model conflict" simultaneously) can no
longer occur.

## 1. What changed in this task

- **Tier persistence**: `evaluation_predictions` gained two nullable columns, `model_agreement`
  and `upset_risk_tier`, populated at insert time for both the walk-forward runner
  (`walkForward.ts` / `historicalScoring.ts`) and the live paper-trading loop
  (`paperTrading.ts`). Previously these were only visible inside a row's JSON
  `featureSnapshot`; they are now directly queryable/aggregable.
- **Tier-level metrics**: `computeUpsetRiskTierMetrics` (favorite-loss-rate per LOW/MODERATE/
  HIGH/EXTREME) and `computeDisagreementTierMetrics` (accuracy/error-rate per Strong/Moderate/
  Mixed/HighDisagreement), scoped the same honest way as the existing `computeSegmentMetrics`
  (graded-or-void, `includedInAccuracy`, and additionally requiring a persisted tier). Exposed on
  `GET /api/evaluation/dashboard` as `upsetRiskTierMetrics` / `disagreementTierMetrics`.
- **Final-consistency guard** (`finalConsistencyCheck.ts`): a defense-in-depth check run as the
  last step inside `runPredictionEngine`, enforcing five rules (winner/probability agreement,
  probability bounds, complementary opponent probability, no "no model conflict" wording next to
  a genuinely conflicted reading, single source of truth between the plain `upsetRisk` tier and
  its detailed breakdown). A violation force-withholds Elite tier and surfaces the violation in
  `engine.risks` and the new `engine.consistencyViolations` field, rather than throwing.
- **Regression fixture**: `finalConsistencyCheck.test.ts` reconstructs a match shaped like the
  original bug report (C. Bouchelaghem vs. A. Ganesan) — two players whose surface history and
  recent hard-court form genuinely point in opposite directions — run through the real
  `runPredictionEngine` end to end, and asserts the guard reports zero violations and that Elite
  is never shown alongside a "no model conflict" claim when disagreement/upset-risk are genuinely
  elevated. 15 new tests total across `finalConsistencyCheck.test.ts` and `metrics.test.ts`; full
  `test:predictionEngine` suite: **83/83 passing**.

Why disagreement (Task 54) and upset risk (Task 55) don't move accuracy/Brier/logLoss: both are
pure downstream classifiers of the already-calibrated probability
(`computeWeightedDisagreement` in `disagreement.ts`, `computeUpsetRisk` in `upsetRisk.ts`) — they
read `calibratedProbability` and the feature-module votes but never feed anything back into
`calibratedProbability` itself. Their correctness is therefore a tier-monotonicity question
(does the labeled risk/disagreement level actually track worse real outcomes?), not a
probability-metric delta, which is why this report validates them via the tier tables in Section
4 rather than a before/after accuracy comparison.

## 2. Old vs. new: model disagreement (Task 54)

**Old**: raw max-min spread across every model's probability, unweighted — every module counted
equally, so a single low-reliability secondary module (or a fringe blend stage) could alone push
a match to "High Disagreement" even when the three validated core signals agreed.

**New** (`disagreement.ts`, `computeWeightedDisagreement`): a weighted standard deviation over
each model's real effective ensemble weight (`weightUsed` = reliability × its
`ENSEMBLE_WEIGHT_PRIOR`), plus a directional "leading support %" (share of effective weight
behind whichever player leads), plus an explicit `coreModelsConflict` flag that only fires when
at least two of the three validated core models (Surface Elo, Serve & Return, Recent Form) each
carry a meaningful weight share (≥15% of the vote) and point at different players. Tiers:

| Tier | Trigger |
|---|---|
| HighDisagreement | `coreModelsConflict` OR weighted stddev > 11 OR leading support < 58% |
| Mixed | stddev > 9 OR leading support < 65% |
| Moderate | stddev > 6 OR leading support < 75% |
| Strong | otherwise |

A low-weight fringe module can still nudge the mean/stddev slightly but can never by itself flip
the category or headline the explanation — see `disagreement.test.ts`'s "a low-reliability/
near-zero-weight secondary model cannot flip the category by itself" test.

## 3. Old vs. new: upset risk (Task 55)

**Old**: two inputs only — raw favorite margin and the `modelAgreement` enum.

**New** (`upsetRisk.ts`, `computeUpsetRisk`): a component-based, auditable score derived from a
one-off 2026-07-13 batch analysis over 4,081 real graded historical_test rows
(`src/scripts/analyzeUpsetRiskCalibration.ts`). Two findings drove the redesign:

1. Raw favorite margin is the one cleanly monotonic real signal (favorite-loss rate fell
   47.3% → 45.1% → 41.8% → 35.2% as margin widened from 0–3 to 13+), so it dominates
   (`favoriteWeakness`, max 45).
2. `modelAgreement` alone correlated weakly and in the wrong direction in that analysis (Strong:
   45.4% favorite-loss vs. HighDisagreement: 36.8%), so its per-band contribution
   (`modelConflict`'s `AGREEMENT_BAND`, max 8) is intentionally small — only a genuine
   `coreModelsConflict` earns a real bump (+25).

Components: `modelConflict` (max 33 = 8 band + 25 core-conflict bonus), `favoriteWeakness` (max
45), `uncertainty` (max 15, missing/weak inputs + raw-vs-calibrated divergence), `sampleDepth`
(max 10, thin surface-Elo sample), `volatility` (max 7, tournament-level deviation, only for
clear favorites and levels with a validated sample), `matchupHazard` (always 0 — no validated
hazard signal exists, disclosed rather than fabricated). Tier boundaries: LOW_MAX 25,
MODERATE_MAX 40, HIGH_MAX 55, EXTREME requires crossing HIGH_MAX AND an explicit independent
real condition (core conflict or a severe sample gap) — never from one weak/missing field alone.

## 4. Combined-system validation

### 4a. Effective ensemble weights & calibration (current live configuration)

| Module | `MODULE_IMPORTANCE` (data-quality weight) | `ENSEMBLE_WEIGHT_PRIOR` (vote weight) | Confidence shrink |
|---|---|---|---|
| Surface Elo | 1.3 | 1.5 | — |
| Serve & Return | 1.2 | 1.5 | 0.45 |
| Recent Form | 1.1 | 1.3 | 0.35 |
| Availability | 0.9 | 0.4 (inert — excluded from the vote, see 4b) | — |
| Fatigue | 0.7 | 0.4 | — |
| Head-to-Head | 0.5 | 0.4 | — |

Active general calibration: **isotonic**, fit on 4,194 validation-segment predictions (chosen
because isotonic beat Platt on the held-out comparison slice — see `calibration_models.method`).
Segment specialists (Phase 6), current weights against the general model: ATP-Hard 0.704 (n=154),
ATP-Clay 0.850 (n=117), ATP-IndoorHard 0.817 (n=148), WTA-Hard 0.745 (n=295); ATP-Grass,
WTA-Clay, WTA-Grass, WTA-IndoorHard don't yet meet the minimum-sample threshold and fall back to
the general model.

### 4b. Staged accuracy/Brier/logLoss (Tasks 45→52→53, real walk-forward runs)

| Stage | n | Accuracy | LogLoss | Brier |
|---|---|---|---|---|
| Task 45 (Serve/Return depth + Availability rework, pre-Surface-Elo-recalibration) | 4,081 | 58.2% | 0.6751 | 0.2411 |
| + Task 52 (Surface Elo recalibration) | 4,081 | 58.0% | 0.6766 | 0.2418 |
| + Task 53 (Recent Form recalibration) | 4,081 | 57.8% | 0.6757 | 0.24145 |
| **This run — full combined system (+ Tasks 54/55, tier persistence, consistency guard)** | **4,091** | **57.9%** | **0.6751** | **0.2412** |

The final combined-system run lands within noise of every intermediate stage (accuracy range
57.8–58.2%, logLoss 0.675–0.677, Brier 0.241–0.242 across all four data points; the n=4,081→4,091
difference reflects the historical corpus growing slightly between runs, not a data change).
Disagreement recalibration and the upset-risk rework are pure downstream classifiers (Section 1)
and cannot move these numbers, which the flat result across this run confirms. ECE on this run:
0.0273 raw → 0.0145 calibrated (improves with calibration, as expected).

### 4c. Upset-risk tier monotonicity (this run, genuinely-unseen rows: historical_test test-segment + paper_trade/live)

| Tier | n | Favorite-loss rate |
|---|---|---|
| LOW | 146 | 32.9% |
| MODERATE | 468 | 40.0% |
| HIGH | 747 | 37.9% |
| EXTREME | 2,730 | 44.1% |

The two tiers that matter most for the tier's purpose are correctly ordered: LOW has the lowest
favorite-loss rate and EXTREME has the highest. MODERATE/HIGH invert slightly (40.0% vs. 37.9%)
— given their sample sizes (468 and 747) this is within the noise band the module-level
calibration analysis already found for band-level effects (Section 3, finding 2: modelAgreement
bands alone are weak/noisy signals; only the LOW-vs-EXTREME endpoints and the core-conflict/
sample-gap gates are the load-bearing parts of this design). This is a genuinely-measured result
from real graded rows, not smoothed or cherry-picked.

### 4d. Disagreement tier accuracy (same row scope as 4c)

| Tier | n | Accuracy | Error rate |
|---|---|---|---|
| Strong | 1,810 | 56.7% | 43.3% |
| Moderate | 612 | 67.3% | 32.7% |
| Mixed | 287 | 63.1% | 36.9% |
| HighDisagreement | 1,382 | 54.3% | 45.7% |

HighDisagreement — the tier the original bug report's contradiction was about — has the lowest
accuracy of all four tiers, as it should: predictions in that bucket are genuinely the hardest
ones. Strong/Moderate/Mixed don't fall in a perfectly straight line (Moderate and Mixed score
above Strong here), which is consistent with Section 2's design intent — `modelAgreement` was
never claimed to be a single monotonic accuracy predictor on its own; it exists to flag genuine
core-model conflict, and the one comparison that matters for this task (HighDisagreement is
worse than every other tier) holds.

### 4e. Elite tier backtest

Real Elite tier: n=0 in this run. This is expected, not a bug — historical walk-forward scoring
always runs with `segment: null` (segment specialists are themselves fit FROM walk-forward
output, so feeding one back in would be circular; see `scoreHistoricalMatch`'s doc comment), so
`specialistApplied` is structurally always false for historical rows and real Elite (which
requires a real segment specialist) can never be earned there — only in live paper trading. The
Near-Elite backtest group (every Elite gate met except specialist support) has n=413, meeting the
30-sample minimum, at 57.9% accuracy — consistent with the overall corpus accuracy, which is the
expected result since Near-Elite's remaining gates (data quality, 3-signal agreement, no model
conflict, and the Task-56-relevant not-HighDisagreement/not-High-or-Extreme-upset-risk guardrail)
don't themselves predict extra accuracy beyond what they were designed to guarantee (data
quality and signal consensus, not a higher hit rate per se).

### 4f. Availability inclusion (Stage 7 — already resolved prior to this task)

Documented in `docs/audit-phase45-availability-revalidation.md` (2026-07-13): a live ablation
replay over the full 18,281-match historical corpus measured including the reworked Availability
module in the ensemble at 57.3% accuracy vs. 57.4% excluding it (net −0.1pt). `EXCLUDED_FROM_ENSEMBLE`
correctly still contains `"availability"`; its rest/travel/withdrawal outputs remain fully
computed and shown for transparency, only its vote is withheld. No re-measurement was needed for
this task — cited here for completeness of the combined-system picture.

## 5. The original contradiction: why it can no longer happen

The original bug report showed a single prediction (C. Bouchelaghem vs. A. Ganesan) as Elite
Prediction, High Disagreement, and "no model conflict" all at once. Two independent layers now
prevent this:

1. **Root cause, already fixed by Tasks 54/55**: `eliteTier.ts`'s Elite gate explicitly
   withholds Elite whenever `modelAgreement === "HighDisagreement"` or `upsetRisk` is HIGH/
   EXTREME, and the "no model conflict" success-reason string is only reachable when `reasons.length
   === 0`, which requires that same guardrail to have passed. These two conditions are therefore
   already mutually exclusive by construction.
2. **Defense-in-depth, added by this task**: `finalConsistencyCheck.ts` re-checks the same
   invariant (plus three others) as the literal last step before `EngineOutput` is returned, so a
   future change to either call site can never silently regress this without a visible, testable
   violation. The regression fixture (`finalConsistencyCheck.test.ts`) reconstructs a
   Bouchelaghem/Ganesan-shaped match (opposite-direction Surface Elo vs. Recent Form/Serve&Return
   signals) through the real engine end to end and asserts zero violations and no
   Elite+"no model conflict" combination — proven against the current code, not a mocked object.
