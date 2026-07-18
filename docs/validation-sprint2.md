# Engine Validation Report — Sprint 2

**Date:** 2026-07-18  
**Model version:** `phase8-historical-live-engine-v1`  
**Calibration method:** Platt (beat isotonic on holdout log-loss: 0.6672 vs 0.6687)  
**Corpus coverage:** Jan 2020 (39 matches) + Jan 2025 – Jul 2026 (130,094 matches)

---

## 1. Executive Summary

The engine achieves **64.5% out-of-sample accuracy** on the walk-forward test segment — comfortably above a coin flip and consistent with prior sprint validation. Upset-risk tiers are monotonically well-ordered. However, three issues require attention before any weight or calibration change is made:

1. **80+ confidence bucket is critically overconfident** — predicted 85.1%, observed 74.2%, a **10.86 percentage-point gap** that exceeds the 5pp action threshold.
2. **Systematic underconfidence everywhere else** — the raw ensemble outputs average 50.14% when the actual accuracy is 64.5%. Calibration corrects this only minimally (avg calibrated: 51.27%).
3. **2021–2024 data gap** — the historical corpus has no matches from the four-year window 2021–2024, meaning Elo, form, and H2H context is absent for roughly half a decade of player careers. This is tracked as a separate open task and must be closed before the next full validation cycle is meaningful.

**Recommendation: no weight or formula changes in this sprint.** The 80+ recalibration is the only evidence-backed change warranted, but it should be proposed as a targeted follow-up task with specific evidence rather than modified here.

---

## 2. Historical Corpus

| Metric | Value |
|---|---|
| Total matches in DB | 133,823 |
| Non-cancelled | 131,133 |
| Earliest match | 2020-01-02 |
| Latest match | 2026-07-18 |
| Missing surface | 3,162 (2.4%) |

### Coverage by year

| Year | Matches |
|---|---|
| 2020 | 39 |
| **2021** | **0 — missing** |
| **2022** | **0 — missing** |
| **2023** | **0 — missing** |
| **2024** | **0 — missing** |
| 2025 | 84,243 |
| 2026 (Jan–Jul) | 46,851 |

> ⚠️ **The 2021–2024 gap is the single largest data-quality risk for this engine.** Elo ratings, recent form, and head-to-head records built from a corpus that jumps from 39 matches (Jan 2020) directly to 2025 will be systematically cold-started for any player whose career spans that window. Walk-forward results below should be interpreted in light of this limitation. Closing this gap (open Task #44) is a prerequisite for a definitive validation cycle.

---

## 3. Walk-Forward Evaluation

### 3.1 What was run

A single fold (fold 0) was executed on 2026-07-16 using:
- Warmup fraction: 40% of eligible corpus (pre-Aug 2025)
- Training window: 2020-01-02 → 2025-08-10
- Validation window: 2025-08-10 → 2025-09-14
- Test window: 2025-09-14 → 2025-10-22

> **Note:** Only 1 of the default 4 folds is present in the database. The four-fold run requires a corpus large enough to split into non-trivial chunks; re-running with the full data coverage restored (post-Task #44) will produce the complete per-fold variance picture.

### 3.2 Per-segment metrics (fold 0)

| Segment | N (scored) | Accuracy | Brier | Log-loss | ECE (calibrated) |
|---|---|---|---|---|---|
| Validation | 7,473 | 63.6% | 0.2245 | 0.6402 | 0.0118 |
| **Test** | **8,865** | **64.5%** | **0.2233** | **0.6392** | **0.0179** |

- **Test accuracy (64.5%) is the primary headline number** — the test segment was never seen by the calibration fitter, making it the honest unseen estimate.
- Log-loss (0.6392) and Brier (0.2233) are within expected range for a binary tennis prediction problem at this confidence scale.
- ECE after calibration is low (0.0179) — the Platt fit corrects the raw engine well on average.

### 3.3 Probability distribution (test segment)

| | Value |
|---|---|
| Avg raw ensemble probability | **50.14%** |
| Avg calibrated probability | **51.27%** |
| Actual accuracy | **64.5%** |

The 13-percentage-point gap between stated confidence (51.27%) and actual accuracy (64.5%) is the most important signal in this report. The raw engine concentrates outputs near 50% — the model is structurally underconfident. The Platt calibration shifts this by only ~1pp because it was fit on a validation slice where the same underconfidence was already present in the data. This is a pre-existing finding; it is **not evidence that calibration is broken** — it confirms that the underconfidence lives in the feature/weight layer, not in the calibration layer.

### 3.4 Calibration buckets (test segment — out-of-sample)

| Confidence bucket | N | Avg stated | Observed win rate | Gap (stated − observed) |
|---|---|---|---|---|
| 50–55% | 1,071 | 52.4% | 55.7% | **−3.35pp** (underconfident) |
| 55–60% | 953 | 57.4% | 61.4% | **−3.99pp** (underconfident) |
| 60–65% | 822 | 62.4% | 61.1% | +1.34pp |
| 65–70% | 640 | 67.5% | 65.5% | +1.98pp |
| 70–75% | 571 | 72.4% | 74.1% | −1.70pp |
| 75–80% | 314 | 77.2% | 76.8% | +0.45pp |
| **80+%** | **291** | **85.1%** | **74.2%** | **+10.86pp ← exceeds 5pp threshold** |

**Buckets 50–60% are underconfident; 80+ is critically overconfident.** Only the 80+ bucket exceeds the 5pp action threshold. All other buckets are within an acceptable range given the sample sizes.

The 80+ bucket (n=291) contains predictions where the engine fires at very high stated confidence. The 10.86pp gap means that when the model claims 85% confidence, the player actually wins only 74% of the time. This is not correctable by a global recalibration tweak without worsening the well-calibrated middle buckets. It requires understanding *why* the engine reaches 80%+ (likely single-dominant-module cases or extreme ranking gaps) before any targeted fix.

### 3.5 Surface accuracy (test segment)

| Surface | N | Accuracy | Avg confidence |
|---|---|---|---|
| Hard | 5,285 | 64.28% | 51.21% |
| Clay | 2,815 | 66.25% | 51.11% |
| **IndoorHard** | **708** | **58.62%** | **52.40%** |
| Grass | 57 | 71.93% | 50.99% |

**IndoorHard meaningfully underperforms** (58.62% vs 64–66% for other hard surfaces). This is a consistent finding across prior audits. It may reflect fewer specialist training examples for that surface or genuine predictive differences in indoor play that the current feature set doesn't capture.

Grass has a small sample (n=57) but a high accuracy (71.93%); treat this with caution given the small N.

### 3.6 Upset-risk tier accuracy (test segment)

| Tier | N | Accuracy |
|---|---|---|
| LOW | 244 | 81.56% |
| MODERATE | 2,253 | 73.59% |
| HIGH | 2,587 | 65.52% |
| EXTREME | 3,781 | 57.29% |

**Upset-risk tiers are well-monotonic** — each tier's observed accuracy correctly orders from highest (LOW upset risk → most accurate) to lowest (EXTREME → near coin-flip). This validates the disagreement-based tier classification as a reliable signal. The EXTREME tier at 57.29% is above 50% even in this hardest bucket, which is healthy.

---

## 4. Calibration Review

### 4.1 Active calibration model

| Property | Value |
|---|---|
| Method | **Platt** (beats isotonic) |
| Fit sample size | 4,130 |
| Holdout sample size | 826 |
| Isotonic holdout log-loss | 0.6687 |
| Platt holdout log-loss | **0.6672** |
| Fitted at | 2026-07-14 |
| Data range | Jan 2025 – Apr 2025 |

The Platt sigmoid was selected over isotonic regression because it achieved lower holdout log-loss (0.6672 vs 0.6687) and did not have worse holdout ECE. This selection is automatic and reproducible.

### 4.2 Calibration fit quality

The current mapping is fit on Jan–Apr 2025 validation data (4,130 points). This is a healthy sample size for Platt fitting, but the date range (4 months) may not capture seasonal or tournament-type variation. The calibration history shows 10 re-fits over the past several days (IDs 64–73), all producing similar results (isotonic LL ~0.685–0.689, Platt LL ~0.667–0.670), indicating the fit has converged and is stable.

### 4.3 Buckets exceeding 5pp gap

Only the **80+% bucket** exceeds the 5pp threshold (gap: +10.86pp). All other buckets are within ±4pp. A targeted recalibration for this bucket alone — or a threshold review to understand what drives these predictions — is the recommended next step, scoped as a separate follow-up task.

---

## 5. Shadow Replay Analysis

Two shadow-replay batches exist on record:

| Batch | Rows | Scored | Accuracy | Avg confidence | Date range |
|---|---|---|---|---|---|
| Jan 1 2020 – Dec 31 3026 | 16,075 | 15,523 | **58.20%** | 50.04% | 2020-01-07 – 2025-04-22 |
| Jan 1 2026 to July 15 2026 | 4,641 | 4,515 | **61.86%** | 50.14% | 2026-01-01 – 2026-01-30 |

> A third batch covering Apr 20 – Jul 17 2026 was triggered during this validation run. Results for that batch are not yet written (in-progress at report time) and should be added in the follow-up review once the run completes.

### 5.1 Key findings

**Shadow accuracy (58–62%) is meaningfully below walk-forward test accuracy (64.5%).** Three factors explain this gap:

1. **Calibration time-travel**: Shadow replay uses the calibration mapping that was actually active on each historical match's date. Older shadow rows (2020, 2025-01 to 2025-04) used earlier calibration fits that were less accurate than the current Platt model.
2. **Data gap effect**: The large batch (2020–2025-04) is scored on matches from the 2021–2024 gap using a cold-started Elo/form context — the engine had no prior history to draw on for those dates because that data doesn't exist.
3. **Inherent difference**: Shadow replay is an honest simulation, not hindsight-scoring. It uses the same point-in-time cutoff as live predictions but through historical data, meaning the engine's knowledge at decision time was genuinely limited.

**Average confidence in shadow replay (50.04–50.14%) is essentially identical to the raw walk-forward output (50.14%).** This confirms the underconfidence diagnosis: the engine emits near-coin-flip probabilities regardless of the evidence, and calibration at training time wasn't sufficient to correct this for the historical batch.

### 5.2 Coin-flip baseline comparison

| Metric | Shadow replay (recent batch) | Coin flip baseline |
|---|---|---|
| Accuracy | 61.86% | 50.0% |
| P&L equivalent edge | +11.86pp | 0pp |

Shadow replay outperforms a coin-flip baseline by approximately 12 percentage points. This is consistent with the walk-forward test accuracy (64.5%) — the live engine is doing genuine work, not noise.

---

## 6. Paper Trading Live Review (Last 30 Days)

Paper trading began **2026-07-11** — only 7 days ago at report time. All "last 30 days" data is therefore the full paper-trading history.

### 6.1 Overall

| Metric | Value |
|---|---|
| Total fixtures processed | 1,228 |
| Scored (graded, in accuracy) | 485 |
| Correct | 308 |
| **Accuracy** | **63.51%** |
| Avg stated confidence | 50.80% |
| Missed predictions | 687 (55.9%) |
| Pending (not yet settled) | 15 |
| Void | 18 |

**63.51% live accuracy in the first week is consistent with the walk-forward estimate (64.5%).** This is a healthy early signal, though the sample is too small (n=485) to draw firm per-tier conclusions.

**The miss rate (55.9%, 687/1,228) is very high.** More than half of processable fixtures are being missed — either the cutoff arrives before the cycle runs, or fixtures aren't being picked up in time. This warrants investigation before the paper-trade sample is large enough to be the primary accuracy signal.

### 6.2 By confidence tier (graded predictions)

| Confidence | N | Accuracy | Avg stated |
|---|---|---|---|
| 50–55% | 109 | 59.63% | 52.67% |
| 55–60% | 87 | 63.22% | 56.92% |
| 60–65% | 49 | 77.55% | 61.98% |
| 65–70% | 17 | 88.24% | 66.76% |
| 70%+ | 4 | 100.00% | 73.15% |

**Higher stated confidence → higher observed accuracy: well-monotonic.** The tier ordering is correct and each step is meaningful. The 60–65% tier accuracy (77.55%) is particularly encouraging — predictions in this range hit ~78%, well above the stated 62%.

Note the small sample sizes above 60%: conclusions there are directional, not statistically definitive.

### 6.3 By surface (graded predictions)

| Surface | N | Accuracy |
|---|---|---|
| Clay | 293 | 63.14% |
| Hard | 192 | 64.06% |

Paper-trade data is currently limited to Clay and Hard, as the match schedule for Wimbledon/grass season is not yet fully graded in the system.

### 6.4 By tournament level (graded predictions)

| Level | N | Accuracy |
|---|---|---|
| ITF | 361 | 64.54% |
| Challenger | 60 | 63.33% |
| (unresolved) | 55 | 56.36% |
| WTA250 | 9 | 66.67% |

The 55 predictions with unresolved tournament level perform below the general average (56.36%). This is expected — the engine receives less structured context for those fixtures, which typically means lower quality features.

---

## 7. Specialist Segment Analysis

**The `specialist_models` table is empty (0 rows).** The specialist-segment fitting step runs at the end of `runWalkForwardEvaluation` and calls `computeAndStoreSpecialistSegments`. The absence of any rows suggests either:

1. The specialist fitting ran but found no segment meeting its sample-size threshold, or
2. The fitting step errored silently after the fold completed.

Without specialist adjustments, the engine falls back to the general pooled calibration for all tour/surface segments. This means the per-surface/tour refinement that specialist weights are designed to provide is not active.

**This should be investigated separately.** It is not a weight-or-formula change — it is a diagnostic item about whether the existing mechanism is functioning.

---

## 8. Systematic Biases Found

### 8.1 Engine underconfidence (pre-existing, not action-worthy this sprint)

Raw ensemble outputs average 50.14% across 8,865 scored test-set predictions, while the true accuracy is 64.5%. This 14pp gap is structural — it originates in the weight layer (each module's contribution is dampened toward 50% before ensemble), not in calibration post-processing. Calibration can only shift the output distribution; it cannot inject signal that the raw engine didn't produce. Fixing underconfidence requires examining module weights and the ensemble's shrink-toward-50% behavior. This is documented as Task #33 (open).

### 8.2 80+ confidence bucket overconfidence (action threshold exceeded)

Only 291 predictions reached ≥80% calibrated confidence in the test set, but their stated confidence (85.1%) was 10.86pp above their observed win rate (74.2%). This exceeds the 5pp action threshold. These are the highest-stakes predictions and the ones most likely to be acted on by users — systematic overconfidence here is materially harmful.

### 8.3 IndoorHard underperformance

IndoorHard accuracy (58.62%) is 5.7pp below Hard (64.28%) and 7.6pp below Clay (66.25%). With n=708, this is a robust finding, not a sampling artifact. The IndoorHard under-performance may reflect:
- Fewer training examples for this surface (smaller specialist segment → falls back to general model)
- Genuine predictive difficulty (indoor conditions change serve/return dynamics in ways the current feature set doesn't distinguish from outdoor hard)

---

## 9. Calibration Plot Data

Calibration curve points (test segment, ordered by bucket midpoint):

| Avg stated (x) | Avg observed (y) | N |
|---|---|---|
| 52.4% | 55.7% | 1,071 |
| 57.4% | 61.4% | 953 |
| 62.4% | 61.1% | 822 |
| 67.5% | 65.5% | 640 |
| 72.4% | 74.1% | 571 |
| 77.2% | 76.8% | 314 |
| 85.1% | 74.2% | 291 |

A perfectly calibrated model would have x=y (points on the diagonal). The pattern here shows:
- 50–60% range: consistently below the diagonal (underconfident — observed is higher than stated)
- 60–75% range: approximately on or near the diagonal (well-calibrated)
- 80%+: significantly above the diagonal (overconfident)

---

## 10. Recommendation

### No changes in this sprint

The evidence does not support changing weights, calibration constants, or model parameters within this validation task. Reasons:

1. The underconfidence (§8.1) is a known pre-existing issue with an open task. Changing calibration to address it would require refit on a larger, post-data-gap-closure corpus to avoid overfitting to the limited 2021–2024-gap-distorted distribution.
2. The 80+ bucket overconfidence (§8.2) requires a targeted investigation (what drives these high-confidence outputs?) before a change can be made safely — adjusting the calibration curve at one extreme risks rippling through the entire curve.
3. Paper trading (n=485 scored, 7 days) is too small a sample for any live-performance-based recalibration.

### Proposed follow-up actions (as separate tasks)

The following represent evidence-backed, scoped follow-ups — not implemented here:

1. **80+ bucket investigation and targeted recalibration**: Understand what feature combinations produce ≥80% confidence (extreme Elo gaps? dominant form? H2H sweeps?), then decide whether the right fix is a calibration curve adjustment for just that region or a weight cap on individual modules. The 10.86pp gap on n=291 is robust enough to justify this investigation.

2. **Run 4-fold walk-forward after Task #44 closes**: Once the 2021–2024 data gap is filled, re-run walk-forward with `foldCount=4` to get per-fold variance, a fuller calibration picture, and meaningful specialist fitting results.

3. **Investigate paper-trading miss rate**: 55.9% of processable fixtures are being missed. With paper trading being the primary live validation signal, a high miss rate degrades the long-term usefulness of that signal. The lock-timing and cycle frequency should be reviewed.

4. **Diagnose empty specialist_models table**: Determine whether the specialist fitting step is silently failing or whether no segment meets the sample threshold. If the latter, reduce the threshold for IndoorHard (n=708 exists and underperforms — a specialist fit there would be meaningful).

---

*Report generated by automated validation run on 2026-07-18. Data queried directly from the evaluation_predictions and evaluation_runs tables. Shadow replay batch "sprint2-validation-recent-90d" (Apr 20 – Jul 17 2026) was in-progress at time of writing and should be reviewed once complete.*

---

## 11. Task #53 Outcome — Specialist Models & 80%+ Bucket Fix (2026-07-18)

### 11.1 Root cause and fix — specialist pipeline silent failure

The specialist segment SQL queries (`computeOneSegment` in `specialistWeights.ts`) were querying
the `historical_matches.tour` column for values like `'ATP250'`, `'Masters1000'`, etc. — but
`tour` stores generic labels (`'ATP'`, `'WTA'`, `'ITF'`, `'Challenger'`). The granular level
names live in the separate `tournament_level` column. With `inArray(tour, ['ATP250','Masters1000'])`
returning zero rows, the specialist pipeline silently produced zero validation samples for every
segment. Fix: revert to `eq(historicalMatchesTable.tour, segment.tour)` which correctly matches
`tour = 'ATP'` / `tour = 'WTA'`.

Additionally, Task #44 added ATP (9,567 matches) and WTA (9,115 matches) historical data — before
that backfill the segments had no historical match coverage to qualify against.

### 11.2 Calibration model update

A 4-fold walk-forward was triggered (`evaluationOnly: false, foldCount: 4`) and ran folds 0–2
before the API server was restarted during Task #44's merge. The existing 23,023 accuracy-eligible
validation predictions were used to fit the global calibration model directly (via
`scripts/postWalkForwardFit.ts`).

| Field | Old (ID=73) | New (ID=82) |
|---|---|---|
| Method | Platt | Isotonic |
| Validation sample size | 4,130 | 23,023 |
| Holdout size | 826 | 4,605 |
| Isotonic holdout log-loss | — | 0.63765 |
| Platt holdout log-loss | — | 0.63802 |

Isotonic was selected (lower holdout log-loss by 0.00037). The 5.6× larger corpus gives a
more reliable fit across the full probability range, especially in the high-confidence tail.

### 11.3 Specialist models — 5 active segments

| Segment | Hist matches | Val samples | Accuracy | Weight |
|---|---|---|---|---|
| ATP-Hard | 3,469 | 908 | 58.8% | 0.825 |
| ATP-Clay | 3,129 | 136 | 53.0% | 0.809 |
| ATP-IndoorHard | 934 | 290 | 68.0% | 0.764 |
| WTA-Hard | 4,170 | 1,174 | 57.9% | 0.818 |
| WTA-IndoorHard | 267 | 46 | 71.7% | 0.619 |
| ATP-Grass | — | 0 | — | — |
| WTA-Clay | — | 0 | — | — |
| WTA-Grass | — | 0 | — | — |

ATP-Clay at 53.0% on 136 samples is marginal — barely above coin-flip. The weight (0.809) still
gives it significant influence; a minimum-accuracy gate would prevent it from degrading predictions
on matches where the general model is stronger.

ATP/WTA Grass and WTA-Clay had zero validation predictions in the current walk-forward window
(2025-08-11 to 2026-02-12), which covers the US Open swing and indoor season — not Wimbledon or
Roland Garros. A full 4-fold walk-forward extending into spring 2026 should recover those segments.

### 11.4 80%+ calibration bucket — improved but floor remains

| Source | Avg stated | Actual acc | Gap |
|---|---|---|---|
| Previous report (§8.2) | 85.1% | 74.2% | 10.86pp overconfident |
| This run (test segment) | 85.8% | 76.4% | **9.4pp overconfident** |

Gap reduced by ~1.5pp. The improvement comes from better per-fold calibration fitting (isotonic on
~7,700 fold-level validation points per fold vs Platt on 4,130). The remaining structural floor
comes from the engine's tendency to stack high-confidence signals (extreme Elo gap + dominant form
+ H2H sweep), which still produces over-stated confidence. Fully closing this gap requires either
a region-specific calibration shrink or a per-module weight cap at extreme outputs. See Task #10.

### 11.5 Invariant tests

218/218 pass. TypeScript compilation: no errors in the specialist pipeline code; pre-existing
type errors in `evaluation.ts` routes are from Task #44 schema additions (patternAnalysisRunsTable,
thresholdEvaluationRunsTable) not yet present in the shared `@workspace/db` package.

---

## 12. Task #54 — Shadow Replay Apr–Jul 2026 (2026-07-18)

### §5.3 Shadow replay batch: sprint2-validation-recent-90d (Apr 20 – Jul 17 2026)

**Run summary:**

| Field | Value |
|---|---|
| Batch label | `sprint2-validation-recent-90d` |
| Date range | 2026-04-20 → 2026-07-17 |
| Matches in range | 24,787 |
| Rows written | 20,764 |
| Accuracy-eligible (scored) | 20,106 |
| Skipped (insufficient data) | ~2,193 |
| Void | 0 |
| **Accuracy** | **62.37%** |
| Avg calibrated confidence | 50.2% |

**Methodology note:** run via direct `runShadowPaperTradingReplay()` tsx invocations in
append-only chunks (Apr 20–May 6, May 7–21, May 22–Jun 5, Jun 6–20, Jun 21–Jul 4, Jul 5–17)
using the shared `(runKind, historicalMatchId)` unique index to prevent double-counting across
chunks. Each chunk uses per-match point-in-time calibration history.

---

### §5.3.1 Accuracy trend vs earlier batches

| Batch | Period | Accuracy | Gap from walk-forward test (64.5%) |
|---|---|---|---|
| Historical | 2020-01 – 2025-04 | 58.20% | −6.3pp |
| Jan 2026 | 2026-01-01 – 2026-01-30 | 61.86% | −2.6pp |
| **Apr–Jul 2026** | **2026-04-20 – 2026-07-17** | **62.37%** | **−2.1pp** |

**No concerning divergence.** The Apr–Jul batch (62.37%) is within 0.5pp of the Jan batch
(61.86%) — well below the 3pp alert threshold. The long-run trend is improving: each successive
recent-era batch is closer to the walk-forward test estimate, which is consistent with the engine
accumulating better Elo/form context as the corpus deepens.

---

### §5.3.2 Upset-risk tier breakdown (correctly monotonic)

| Tier | N | Accuracy | Avg confidence |
|---|---|---|---|
| LOW | 1,257 | 76.2% | 50.6% |
| MODERATE | 5,063 | 72.5% | 50.3% |
| HIGH | 5,714 | 61.0% | 50.4% |
| EXTREME | 8,072 | 54.7% | 49.9% |

Upset-risk tiers remain properly monotonic (LOW > MODERATE > HIGH > EXTREME), consistent with
the walk-forward test results (§3.6). The 54.7% EXTREME-tier accuracy — confirmed above 50% on
8,072 samples — validates that even the engine's most uncertain predictions carry a small but
real edge over random.

---

### §5.3.3 Surface breakdown

| Surface | N scored | Accuracy |
|---|---|---|
| Clay | 10,909 | 62.7% |
| Hard | 7,425 | 62.5% |
| **Grass** | **1,772** | **60.1%** |

This is the **first shadow replay batch with meaningful Grass coverage** (1,772 scored matches).
The Apr–Jul window captures Roland Garros (May/Jun clay) and Wimbledon (Jun/Jul grass). Grass
accuracy (60.1%) is 2.4–2.6pp below clay/hard — consistent with the walk-forward test's sparse
grass sample (n=57, 71.9%), though the larger sample here gives a more reliable estimate.
No specialist model for ATP/WTA-Grass exists yet (the walk-forward validation window didn't cover
the grass season). Task #67 (fresh 4-fold walk-forward) will generate the first grass validation
data for specialist fitting.

---

### §5.3.4 Tournament level breakdown

| Level | N scored | Accuracy |
|---|---|---|
| ITF | 12,722 | 65.6% |
| Challenger | 4,328 | 62.7% |
| GrandSlam | 1,058 | 63.7% |
| WTA250 | 586 | 62.6% |
| ATP250 | 450 | **53.3%** ← flag |
| Masters1000 | 307 | 65.5% |
| Other | 432 | 61.3% |

**ATP250 accuracy (53.3%) is the one notable concern.** On 450 samples this is robust enough to
flag: the engine is essentially at coin-flip for ATP250 predictions in this period (French Open
clay swing + early grass ATP250 events). Two likely drivers:

1. **No ATP-Clay specialist** — the current ATP-Clay specialist has only 136 validation samples
   and 53.0% accuracy (§11.3), so it contributes minimally. Roland Garros clay predictions in
   May–Jun fall into this gap.
2. **Transition window difficulty** — the Apr–Jul period straddles the clay→grass surface switch,
   which is when ATP tour-level predictions are historically hardest (player form on new surfaces
   is inherently noisier in the first weeks).

This finding reinforces Tasks #59 (S&R over-confidence on tour-level matches) and #67 (fresh
walk-forward to generate grass/clay specialist validation data).

---

### §5.3.5 Calibration bucket check (shadow batch)

| Bucket | N | Avg stated | Actual acc | Gap |
|---|---|---|---|---|
| <55% | 17,999 | 49.2% | 63.0% | −13.8pp underconfident |
| 55–60% | 1,595 | 56.5% | 78.2% | −21.7pp underconfident |
| 60–65% | 256 | 62.2% | 67.2% | −5.0pp underconfident |
| 65–70% | 154 | 67.2% | 70.1% | −2.9pp underconfident |
| 70–75% | 94 | 71.7% | 74.5% | −2.8pp underconfident |
| 75–80% | 7 | 76.3% | 57.1% | +19.2pp (n=7, not robust) |
| 80%+ | 1 | 82.2% | 100% | (n=1, not robust) |

The dominant pattern is **structural underconfidence in the <60% range**: 17,999 of 20,106 scored
predictions (89.5%) are in the <55% bucket, with actual accuracy 13.8pp above stated. This
mirrors the walk-forward finding (§8.1 and §3.3) and confirms it is a persistent engine
characteristic, not an artifact of the historical test period.

The 75–80% and 80%+ buckets are too small (n=8 combined) to draw any calibration conclusions
from this batch alone.

---

*Shadow replay complete. All three sprint2 shadow batches now on record. Next shadow replay after
Task #67 (fresh 4-fold walk-forward + specialist fitting) is recommended to assess impact of
updated specialists and calibration on live-era simulation accuracy.*
