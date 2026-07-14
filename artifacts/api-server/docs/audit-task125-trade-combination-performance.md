# Read-Only Audit: Trade-Combination Performance Breakdown

**Task #125.** Read-only analysis only — no engine code, thresholds, or formulas were modified to
produce this report. All numbers below were computed by querying `evaluation_predictions` directly
and re-deriving display-only fields (Recommendation tier, Data Quality label, Elite status) with the
exact same production functions the app itself uses (`computeRecommendation`, `computeEliteTier`,
`computeNearEliteTier`, `voteFavorsPlayer1`) and the same accuracy/logLoss/calibration math the
Accuracy dashboard already uses (`computeSegmentMetrics` in `services/evaluation/metrics.ts`). Where
a field could not be honestly reconstructed for a row (see §1), that row is excluded from the
relevant breakdown rather than guessed at.

Date of this audit: **2026-07-14**.

## 0. Dataset used, and why

Per the task spec, `historical_test` and `paper_trade`/`live` run kinds are analyzed **separately**
throughout — they are never pooled into one set of numbers, because they represent structurally
different things (walk-forward backtest replay vs. genuinely live-locked, real-time predictions).

- **Historical (`run_kind = historical_test`)**: 6,962 rows, all already `graded` or `void` — no
  `pending`/`missed` rows in this run kind (expected; historical rows are graded synchronously as
  part of the walk-forward run).
- **Live (`run_kind IN ('paper_trade', 'live')`)**: 111 rows, **all with status `missed`, zero
  `graded`**.

This second point is the headline dataset-validity finding and it caps what this audit can say about
live performance: **there is currently no live/paper-trade outcome data to analyze.** Every
single-category and combination breakdown below for the live run kinds is consequently empty ("no
data" / n=0), not a null result — the live pipeline has locked 111 predictions but none have been
graded against a real completed match yet. This is consistent with the live-pipeline fix already
tracked as an open, separate item on the task board; this audit does not attempt to diagnose or fix
that pipeline, only reports the current state of its data honestly.

**Everything from here on is about the historical dataset only**, with the live dataset's emptiness
called out again in §8 so it isn't lost.

## 1. Reconstruction coverage caveats (read before the numbers)

- **Recommendation tier** is not a stored column — it is reconstructed via `computeRecommendation()`
  from `calibratedProbability` (column), `upsetRiskTier` (column), `modelAgreement` (column), and
  `dataQuality` score (`featureSnapshot.dataQuality`). Rows missing any of these (mostly
  pre-upset-risk-tier legacy rows) are excluded from every Recommendation-based breakdown. This
  reduces historical coverage from 6,962 rows to the 5,077 that have `includedInAccuracy = true`
  under `computeSegmentMetrics`'s own existing graded/void + included-in-accuracy filter — the same
  filter every other segment on the Accuracy dashboard already uses, not a new exclusion invented
  for this audit. Concretely: **1,885 historical rows (27.1%) are excluded from every accuracy/
  calibration number in this report**, split identically across every dimension because
  `includedInAccuracy` is a per-row flag independent of which dimension you slice by.
- **Data Quality label** is not persisted as a string anywhere in the snapshot — only the numeric
  score is (`featureSnapshot.dataQuality`). The label shown here is re-derived from that score using
  the exact same thresholds as `computeDataQuality()` (>=85 Excellent, >=65 Strong, >=45 Acceptable,
  >=25 Limited, else Poor) rather than inventing new bands. No row in the included set actually
  scored below 25, so **no historical rows land in "Poor"** — every DO_NOT_RECOMMEND-eligible-by-DQ
  row that could have appeared did not exist in this sample.
- **Elite / Near-Elite status** is reconstructed the same way `eliteTierBacktest.ts` already does for
  the live dashboard's Elite Tier Backtest panel (`classifyEliteTierRow`): it requires the full
  engine breakdown (per-model votes, model agreement, model conflict, specialist-applied flag, upset
  risk) to be present in `featureSnapshot.engine`. Rows without it are counted as "Neither" here,
  matching the dashboard's own convention.
- **Core-model agreement** (used in one named combo below) means Surface Elo, Serve & Return, and
  Recent Form all point to the same player directionally — the same three-signal check
  `computeEliteTier` itself uses, not a new definition.

## 2. Single-category breakdowns (historical, n = included-in-accuracy count)

### 2a. Upset Risk tier

| Tier | n | Accuracy | Avg. predicted | Calib. gap | Log loss |
|---|---|---|---|---|---|
| LOW | 451 | 62.5% | 64.6% | +2.1 | 0.663 |
| MODERATE | 964 | 60.1% | 58.8% | -1.3 | 0.679 |
| HIGH | 1,666 | 58.8% | 56.4% | -2.4 | 0.674 |
| EXTREME | 1,996 | 52.9% | 54.3% | +1.4 | 0.688 |

Monotonic in the expected direction (LOW best, EXTREME worst) — consistent with the tier's intended
meaning. All four cells clear n≥100.

### 2b. Recommendation (reconstructed)

| Recommendation | n | Accuracy | Avg. predicted | Calib. gap | Log loss |
|---|---|---|---|---|---|
| STRONG_RECOMMENDATION | 21 | 81.0% | 73.7% | -7.3 | 0.492 | **n<100 — inconclusive** |
| MODERATE_LEAN | 1,172 | 61.1% | 62.8% | +1.7 | 0.673 | |
| HIGH_RISK | 2,117 | 59.3% | 55.7% | -3.6 | 0.675 | |
| NO_STRONG_SIGNAL | 1,767 | 51.3% | 53.8% | +2.5 | 0.692 | |

STRONG_RECOMMENDATION looks excellent (81.0% accuracy) but only 21 rows currently qualify in the
whole historical set — far below the reliability bar, so this is a promising signal, not evidence.
No DO_NOT_RECOMMEND rows exist to report (see §1 — no row scored DQ<25 in this sample).

### 2c. Predicted-probability band

| Band | n | Accuracy | Avg. predicted | Calib. gap | Log loss |
|---|---|---|---|---|---|
| 50-60% | 4,062 | 55.9% | 55.0% | -0.9 | 0.682 |
| 60-65% | 700 | 61.7% | 62.1% | +0.4 | 0.668 |
| 65-70% | 259 | 57.9% | 67.0% | **+9.1** | 0.700 |
| 70-75% | 47 | 72.3% | 71.9% | -0.4 | 0.590 | **n<100 — inconclusive** |
| 75%+ | 9 | 100% | 75.8% | -24.2 | 0.277 | **n<100 — inconclusive** |

The 65-70% band (n=259, well above the reliability bar) is notably overconfident: the model predicts
67.0% on average but only wins 57.9% of the time, a real +9.1-point calibration gap. This is the
single clearest calibration weak spot in the whole dataset that has enough sample to trust.

### 2d. Data Quality band (re-derived label)

| Label | n | Accuracy | Avg. predicted | Calib. gap | Log loss |
|---|---|---|---|---|---|
| Limited | 2,236 | 57.2% | 56.1% | -1.1 | 0.679 |
| Acceptable | 1,491 | 57.8% | 57.2% | -0.6 | 0.681 |
| Strong | 1,185 | 56.6% | 57.5% | +0.9 | 0.679 |
| Excellent | 165 | 50.9% | 57.7% | +6.8 | 0.686 |

Higher Data Quality is **not** associated with better accuracy or calibration here — "Excellent" is
the worst-performing band on both accuracy and calibration gap. This lines up with this codebase's
own prior finding (memory: DQ threshold calibration reversal) that high Data Quality stopped meaning
"trustworthy" after the DQ module blend changed; this dataset shows the same pattern persisting.

### 2e. Model Agreement

| Agreement | n | Accuracy | Avg. predicted | Calib. gap | Log loss |
|---|---|---|---|---|---|
| Moderate | 1,089 | 65.4% | 60.6% | -4.8 | 0.652 |
| Mixed | 106 | 66.0% | 62.5% | -3.5 | 0.641 |
| Strong | 2,019 | 56.4% | 56.8% | +0.4 | 0.688 |
| HighDisagreement | 1,863 | 52.3% | 54.2% | +1.9 | 0.689 |

"Moderate" and "Mixed" agreement outperform "Strong" agreement on both accuracy and log loss here,
which is counter-intuitive at face value. This is a real pattern in this sample, not a claim that
"Strong" agreement is meaningless — see §7's caveat before acting on it.

### 2f. Elite status (reconstructed)

| Status | n | Accuracy | Avg. predicted | Calib. gap | Log loss |
|---|---|---|---|---|---|
| Neither | 4,091 | 56.5% | 55.7% | -0.8 | 0.680 |
| NearElite | 986 | 59.1% | 61.1% | +2.0 | 0.679 |
| Elite | 0 | — | — | — | — |

**Zero historical rows currently qualify as real Elite tier** under the full reconstruction (segment
specialist support included). NearElite (every Elite gate met except specialist backing) beats
"Neither" on accuracy by 2.6 points, a modestly positive but not dramatic signal at a real sample
size.

### 2g. Surface

| Surface | n | Accuracy | Avg. predicted | Calib. gap | Log loss |
|---|---|---|---|---|---|
| Hard | 3,371 | 56.8% | 56.7% | -0.1 | 0.681 |
| Clay | 1,170 | 56.9% | 56.7% | -0.2 | 0.679 |
| IndoorHard | 503 | 58.3% | 57.3% | -1.0 | 0.675 |
| Grass | 33 | 63.6% | 55.2% | -8.4 | 0.670 | **n<100 — inconclusive** |

No material surface disparity among the three surfaces with real sample size.

### 2h. Tournament level

| Level | n | Accuracy | Avg. predicted | Calib. gap | Log loss |
|---|---|---|---|---|---|
| ATP500 | 252 | 61.5% | 60.5% | -1.0 | 0.669 |
| WTA1000 | 146 | 59.6% | 60.0% | +0.4 | 0.674 |
| ITF | 2,944 | 57.6% | 55.6% | -2.0 | 0.678 |
| WTA250 | 200 | 58.5% | 59.1% | +0.6 | 0.667 |
| ATP250 | 292 | 55.5% | 59.1% | +3.6 | 0.678 |
| Challenger | 1,079 | 55.1% | 57.3% | +2.2 | 0.690 |
| Masters1000 | 164 | 51.8% | 58.9% | **+7.1** | 0.688 |

Masters1000 (n=164) shows the largest calibration gap of any tournament level with real sample size
— the model is meaningfully overconfident at the sport's highest non-Slam level.

## 3. Named combinations (historical; live has zero graded rows for all of these — see §0)

| Combination | n | Accuracy | Avg. predicted | Calib. gap | Log loss |
|---|---|---|---|---|---|
| Elite + Low Upset Risk | 0 | — | — | — | — |
| Elite + Moderate Lean | 0 | — | — | — | — |
| Strong Recommendation + Low Upset Risk | 21 | 81.0% | 73.7% | -7.3 | 0.492 | **n<100** |
| Moderate Lean + Low Upset Risk | 428 | 61.4% | 64.2% | +2.8 | 0.672 | |
| Moderate Lean + Moderate Upset Risk | 455 | 58.9% | 61.7% | +2.8 | 0.685 | |
| High Data Quality (Strong/Excellent) + Low Upset Risk | 311 | 64.3% | 64.4% | +0.1 | 0.657 | |
| High Data Quality (Strong/Excellent) + core-model agreement | 859 | 58.0% | 59.3% | +1.3 | 0.676 | |

("Moderate Upset Risk" is used above as the mapping for the task's "Medium Upset Risk" — the
engine's actual tier vocabulary is LOW/MODERATE/HIGH/EXTREME, with no separate "Medium" tier.)

Two results stand out with real sample size:
- **High Data Quality + Low Upset Risk** (n=311) is the best-calibrated named combo with a real
  sample: 64.3% accuracy, a +0.1-point calibration gap (essentially perfectly calibrated), and the
  best log loss (0.657) of any named combo above the reliability bar.
- **Elite tier currently has zero rows in every combination that requires it** (see §2f) — the two
  Elite-gated named combos cannot be evaluated at all right now, not because they perform badly but
  because nothing currently qualifies as Elite in this historical sample.

## 4. Probability bands (explicit callout)

Already shown in §2c. Restated for convenience:

| Band | n | Accuracy | Calib. gap |
|---|---|---|---|
| 60-65% | 700 | 61.7% | +0.4 |
| 65-70% | 259 | 57.9% | **+9.1** |
| 70-75% | 47 | 72.3% | -0.4 (n<100) |
| 75%+ | 9 | 100% | -24.2 (n<100) |

Only 60-65% and 65-70% clear the reliability bar. 65-70% is the clearest, best-supported calibration
problem found anywhere in this report.

## 5. Full four-way ranking (Upset Risk × Recommendation × Probability band × Data Quality label)

66 distinct combinations exist in the historical data; only **12 clear n≥100**. Ranked by accuracy →
calibration gap (absolute) → log loss → n, the top reliable combos are:

| Rank | Combination | n | Accuracy | Calib. gap | Log loss |
|---|---|---|---|---|---|
| 1 | HIGH + MODERATE_LEAN + 60-65% + Limited | 209 | 64.1% | -2.3 | 0.656 |
| 2 | LOW + MODERATE_LEAN + 60-65% + Strong | 152 | 67.1% | -4.5 | 0.639 |
| 3 | HIGH + HIGH_RISK + 50-60% + Limited | 882 | 60.0% | -4.4 | 0.674 |
| 4 | MODERATE + MODERATE_LEAN + 60-65% + Acceptable | 101 | 59.4% | +2.9 | 0.683 |
| 5 | MODERATE + HIGH_RISK + 50-60% + Strong | 206 | 59.2% | -3.0 | 0.679 |
| 6 | HIGH + HIGH_RISK + 50-60% + Acceptable | 326 | 57.7% | -3.1 | 0.681 |
| 7 | MODERATE + HIGH_RISK + 50-60% + Acceptable | 246 | 62.6% | -6.4 | 0.670 |
| 8 | EXTREME + NO_STRONG_SIGNAL + 50-60% + Limited | 882 | 51.2% | +2.6 | 0.692 |
| 9 | EXTREME + NO_STRONG_SIGNAL + 50-60% + Acceptable | 430 | 53.0% | +0.8 | 0.690 |
| 10 | EXTREME + NO_STRONG_SIGNAL + 50-60% + Strong | 372 | 51.3% | +2.6 | 0.693 |
| 11 | EXTREME + HIGH_RISK + 50-60% + Limited | 129 | 62.0% | -5.4 | 0.664 |
| 12 | LOW + MODERATE_LEAN + 60-65% + Acceptable | 86 | 55.8% | +6.7 | 0.701 | (n<100 — listed for completeness, does not clear the bar) |

**Best reliable (n≥100) Upset Risk + Lean + Probability + Data Quality combination:
`HIGH upset risk + MODERATE_LEAN + 60-65% probability + Limited data quality`** (n=209): 64.1%
accuracy, -2.3 calibration gap, 0.656 log loss — the best-ranked cell that clears the n≥100 bar on
the full accuracy→calibration→logloss→n ordering. Note it pairs HIGH upset risk with a positive
outcome, which is a real pattern in this data but should not be read as "upset risk doesn't matter"
in general — see §2a, where the aggregate HIGH-risk tier as a whole still underperforms LOW-risk.

## 6. ROI

**No ROI could be computed anywhere in this report, for either run kind.** A direct query of
`evaluation_predictions.odds_player1_decimal` / `odds_player2_decimal` across the entire table found
**zero rows with real odds populated** — not just zero among graded rows, zero across all 7,073 rows
in both run kinds combined. Real odds capture is not yet happening for any prediction in this
database as of this audit's date, historical or live. This is a data-availability gap, not a
methodology choice — no ROI column in this report should be read as "0% ROI"; it means "not
measurable with current data."

## 7. Reliability-bar caveat (applies to every table above)

Every table above flags cells with n<100 explicitly rather than silently including them at equal
weight to reliable cells. A handful of striking numbers in this report (STRONG_RECOMMENDATION's 81%
accuracy, the 75%+ band's 100% accuracy) come from cells this small and should be read as "worth
watching once more data accumulates," not as validated performance.

Separately: correlation is not causation here. Several counter-intuitive orderings above (Moderate/
Mixed model agreement outperforming Strong agreement; HIGH upset risk appearing inside the single
best-ranked 4-way combo) are real patterns in this specific historical sample, not necessarily
generalizable rules — this audit does not attempt to explain *why* they occur or propose threshold
changes, which is explicitly out of scope for a read-only audit.

## 8. Summary table

| Dataset | Total rows | Graded | Included in accuracy | Real Elite rows | Rows with real odds |
|---|---|---|---|---|---|
| Historical (`historical_test`) | 6,962 | 6,962 (100%) | 5,077 (72.9%) | 0 | 0 |
| Live (`paper_trade`/`live`) | 111 | **0 (0%)** | 0 | 0 | 0 |

| Best supported finding | Value |
|---|---|
| Best-calibrated named combo (n≥100) | High Data Quality + Low Upset Risk — 64.3% acc, +0.1 calib. gap, n=311 |
| Best-ranked full 4-way combo (n≥100) | HIGH risk + Moderate Lean + 60-65% + Limited DQ — 64.1% acc, -2.3 gap, n=209 |
| Clearest calibration problem with real sample | 65-70% probability band — +9.1pt overconfidence gap, n=259 |
| Clearest tier-level ordering | Upset Risk tier: LOW (62.5%) > MODERATE (60.1%) > HIGH (58.8%) > EXTREME (52.9%) |

## 9. Trust recommendation

Restricted to combinations that clear n≥100 (per the task's own reliability bar):

- **Trust with real confidence:** the Upset Risk tier ordering (§2a) and the single-category Data
  Quality, Model Agreement, Surface, and Tournament Level breakdowns (§2d–2h) — all have large
  samples and stable, reproducible numbers.
- **Trust cautiously, watch as more data accumulates:** the "High Data Quality + Low Upset Risk"
  named combo (§3) and the top-ranked 4-way combo (§5) — both n≥100 but drawn from only 12 of 66
  possible 4-way cells that clear the bar; treat as the current best lead, not a settled result.
- **Do not trust yet, insufficient sample:** STRONG_RECOMMENDATION as a whole (n=21), the 70-75% and
  75%+ probability bands (n=47, n=9), and every "Elite" row/combo (n=0 currently reconstructible).
- **Cannot be assessed at all right now:** anything about live/paper-trade performance (0 graded
  rows) and anything about real-money ROI (0 rows with real odds anywhere in the table). Both are
  data-availability gaps this audit surfaces but does not fix, consistent with its read-only scope.

## Methodology notes / caveats that apply to this entire report

- All accuracy/logLoss/calibration math reuses `computeSegmentMetrics` from
  `services/evaluation/metrics.ts` — the exact function the live Accuracy dashboard uses for every
  other segment — rather than re-deriving new math for this report.
- Recommendation tier and Elite/Near-Elite status are reconstructed using the exact production
  functions (`computeRecommendation`, `computeEliteTier`, `computeNearEliteTier`,
  `voteFavorsPlayer1`) against each row's own stored inputs, mirroring the precedent
  `eliteTierBacktest.ts` already established for the live dashboard's Elite Tier Backtest panel.
  Data Quality *label* specifically had to be re-derived from the stored numeric score using
  `computeDataQuality`'s documented thresholds, since the label string itself is not persisted.
- No source code, threshold, or formula was changed to produce this report — every number above came
  from read-only queries against `evaluation_predictions` plus in-memory aggregation. The temporary
  analysis script used to compute these numbers was deleted after use; only this markdown report is
  the deliverable.
- "Included in accuracy" (§1) matches the existing dashboard convention exactly (graded-or-void
  status AND `includedInAccuracy = true`) — this report does not introduce a new filtering rule.
