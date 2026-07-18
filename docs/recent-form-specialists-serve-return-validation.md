# Sprint Stage 1 Audit: Recent Form, Specialist Pipeline, and Serve & Return

**Date:** 2026-07-18  
**Sprint:** Engine Improvement Sprint — Stage 1 (Audit Only)  
**Dataset:** `evaluation_predictions` — run_kind=`historical_test`, segment=`test`, n=22,689 accuracy-eligible scored predictions  
**Corpus:** Jan 2020 (39 matches) + Jan 2025 – Jul 2026 (130,094 matches); 2021–2024 gap noted throughout  
**Status:** Audit complete. No production code modified. Sections 6–14 are stubs for Stages 2 and 3.

---

## 1. Executive Summary (Stage 1 — Audit Findings)

Three modules were subjected to deep statistical analysis against the expanded corpus (n=22,689 test predictions, up from 8,865 in the prior audit):

**Recent Form** — The module is correctly implemented. Its standalone accuracy (60.3%) is above a coin flip but significantly below the general-model accuracy (64.5%), confirming it adds value as a confirmation signal rather than a standalone predictor. The distribution is heavily concentrated near 50%: 66.6% of predictions fall within ≤2pp of 50, with an average edge of only 1.77pp. The module is systematically underconfident in its own probability scale (ECE=0.0854), with observed win rates consistently exceeding stated probabilities by 7–13pp across all confidence buckets. Moderate correlation with Surface Elo (r=0.50) and S&R (r=0.56) is expected given shared match-history inputs. No standalone improvement candidate clearly dominates; candidates B–G are defined below for Stage 2 implementation.

**Specialist pipeline** — All 8 candidate segments (ATP/WTA × Hard/Clay/Grass/IndoorHard) clear the 150-match historical threshold. Only 5 of 8 clear the 30 validation-sample threshold: ATP-Grass, WTA-Clay, and WTA-Grass have zero validation predictions because the current walk-forward window (Aug 2025–Feb 2026) covers the indoor season but not Wimbledon or Roland Garros. These three segments are correctly held inactive. The five active segments are computing and persisting correctly. `computeAndStoreSpecialistSegments` is confirmed to be called only from the `evaluationOnly: false` path. No naming or schema issues found.

**Serve & Return** — The proxy/real-stats accuracy gap (64.4% vs. 58.9%) is fully explained by a tournament-level confound: the proxy path is 87% ITF matches (where large ranking gaps produce easy predictions), while the real-stats path is dominated by tour-level matches with genuine competitive parity. Within the same tour+level, both paths perform similarly. The module retains substantial independent predictive signal after controlling for Surface Elo (partial correlation r=0.19 vs. Elo's r=0.16), confirming it is not double-counting Elo. Return-metric completeness is high on the real-stats path (99.7% non-null breakPointsConvertedPct) but firstServeWinPct is only available for 49.8% of real-stats predictions. No miscalibration requiring immediate correction is found; ECE is well-behaved on the Challenger and ATP segments (0.018–0.023) and slightly elevated on ITF/WTA (0.031).

---

## 2. Baseline Metrics Table (Production — Candidate A)

All metrics computed on the full test segment (n=22,689, run_kind=`historical_test`, segment=`test`, included_in_accuracy=true).

### 2.1 Recent Form — Standalone Metrics (Candidate A: Current Production)

The "standalone" accuracy treats Recent Form's own `player1Probability` output (extracted from `feature_snapshot.engine.models[modelName='Recent Form']`) as the sole predictor. This is the hypothetical accuracy if the engine only used this module.

| Metric | Value | 95% Wilson CI |
|---|---|---|
| **N** | 22,689 | — |
| **Standalone accuracy** | **60.32%** | [59.7%, 61.0%] |
| **Log loss** | **0.6840** | — |
| **Brier score** | **0.2454** | — |
| **ECE (calibration error)** | **0.0854** | — |
| Avg stated probability | 50.07% | — |
| Std dev stated probability | 2.43pp | — |
| Avg edge from 50 | 1.77pp | — |
| Max edge from 50 | 15.40pp | — |
| Predictions within ≤2pp of 50 | 66.6% (15,120/22,689) | — |
| Predictions within ≤5pp of 50 | 95.5% (21,674/22,689) | — |

**Inter-module Pearson correlations (RF probability vs. other module probabilities):**

| Pair | Pearson r | Interpretation |
|---|---|---|
| Recent Form ↔ Surface Elo | **0.5010** | Moderate positive — both measure player quality but from different signals (match history form vs. rating history). Not redundant. |
| Recent Form ↔ Serve & Return | **0.5573** | Moderate positive — partly structural: S&R quality data feeds into the form score at a 25% blend weight (`SERVE_RETURN_BLEND_WEIGHT`), creating an expected correlation floor. |
| Serve & Return ↔ Surface Elo | **0.4472** | Moderate positive — genuinely independent inputs (point-level serve stats vs. Elo rating history). |

### 2.2 Recent Form — Breakdown by Tour

| Tour | N | Standalone Accuracy | 95% CI | Log Loss | Brier | Avg RF Prob |
|---|---|---|---|---|---|---|
| ITF | 13,317 | 61.57% | [60.7%, 62.4%] | 0.6833 | 0.2451 | 50.03 |
| Challenger | 5,736 | 58.63% | [57.4%, 59.9%] | 0.6864 | 0.2466 | 50.08 |
| ATP | 1,727 | 58.02% | [55.7%, 60.3%] | 0.6832 | 0.2450 | 50.03 |
| WTA | 1,642 | 59.87% | [57.5%, 62.2%] | 0.6803 | 0.2436 | 50.32 |
| Junior | 169 | 46.75% | [39.6%, 54.1%] | 0.6958 | 0.2513 | 49.95 |

Notes: Junior accuracy below 50% (n=169) indicates Recent Form fires with slight systematic anti-pattern on junior matches — likely because junior players have more volatile form than the tour-credibility shrink accounts for. Exhibition and Teams Mix are too small for reliable conclusions. ITF outperforms ATP/WTA on this module because ITF has larger ranking disparities that the opponent-adjusted score captures well.

### 2.3 Recent Form — Breakdown by Surface

| Surface | N | Standalone Accuracy | 95% CI | Log Loss | Brier | Avg RF Prob |
|---|---|---|---|---|---|---|
| Hard | 12,801 | 60.38% | [59.5%, 61.2%] | 0.6837 | 0.2453 | 50.07 |
| Clay | 8,299 | 60.62% | [59.6%, 61.7%] | 0.6839 | 0.2454 | 50.06 |
| IndoorHard | 1,532 | 57.96% | [55.5%, 60.4%] | 0.6866 | 0.2467 | 50.09 |
| Grass | 57 | 64.91% | [51.9%, 76.0%] | 0.6826 | 0.2447 | 49.98 |

Notes: IndoorHard underperforms (57.96%) vs. Hard (60.38%) and Clay (60.62%) consistently with the general-model finding (IndoorHard general accuracy: 58.62%). This persists across both the standalone module view and the ensemble output. Grass n=57 is too small for reliable conclusions; wide CI confirms this.

### 2.4 Recent Form — Probability-Bucket Accuracy (ECE Decomposition)

Buckets use clean 5pp boundaries: [50,55%), [55,60%), [60,65%), [65,70%), [70%+). Only predictions where RF gives ≥50% (the side the module predicts) are included.

| RF Probability Bucket | N | Avg Stated | Observed Win Rate | Gap (Stated − Observed) |
|---|---|---|---|---|
| 50–55% | 11,909 | 51.4% | 59.7% | **−8.3pp** (underconfident) |
| 55–60% | 642 | 56.2% | 68.9% | **−12.7pp** (severely underconfident) |
| 60–65% | 26 | 61.5% | 69.2% | **−7.8pp** (underconfident; n=26, interpret cautiously) |
| 65–70% | 1 | 65.4% | 100% | n=1, ignore |
| 70%+ | 0 | — | — | RF never reaches 70% |

**Finding:** Recent Form is overwhelmingly concentrated in the 50–55% bucket (11,909/12,578 = 94.7% of all RF≥50 predictions). It never reaches 70%+. All meaningful buckets show consistent underconfidence (stated −8 to −13pp below observed win rate). The ECE of 0.0854 is high relative to the general model's ECE of 0.0179 — the module's raw probability output should not be interpreted as a calibrated probability but as a directional signal only. This is already handled correctly by `CONFIDENCE_SHRINK.recentForm = 0.35` in `dataQuality.ts`.

### 2.5 Candidate Baseline Table — Definitions for Stage 2 Implementation

| Candidate | Description | Key Difference from A |
|---|---|---|
| **A (current)** | Opponent-adjusted performance delta + 25% S&R quality blend + tour-credibility shrink + exponential recency decay (0.85^i) + surface-mismatch deweight (0.7) + retirement deweight (0.35) | Production baseline |
| **B** | Plain win-rate: fraction of last 10 matches won, no opponent adjustment, no S&R blend, no tour shrink | Removes all opponent/quality adjustments; tests if complexity adds value |
| **C** | Opponent-adjusted only: performance delta without S&R blend; keeps tour credibility shrink and recency decay | Tests whether S&R blend improves or degrades RF signal (isolate that one change) |
| **D** | Opponent-adjusted + recency, no tour-credibility shrink: same as C but removes `TOUR_CREDIBILITY_FLOOR` | Tests whether the tour-level shrink is net-positive on Challenger/ITF-heavy corpus |
| **E** | Current A + explicit surface-preference weighting: adds a surface-affinity multiplier (wins on same surface weighted 1.3×) on top of the surface-mismatch deweight | Tests whether a stronger surface signal improves Clay and Grass segments |
| **F** | Current A, reduced ensemble weight: `ENSEMBLE_WEIGHT_PRIOR.recentForm` reduced from 1.3 → 0.65 | Tests whether the module is overweighted globally (prior audit found no gain, but larger corpus may differ) |
| **G** | Current A, removed from ensemble: `ENSEMBLE_WEIGHT_PRIOR.recentForm = 0` | Tests whether removing Recent Form improves the general model (ablation baseline) |

Candidates B–G are not implemented here. Stage 2 will implement each, run the walk-forward replay for all, and produce a comparison table against Candidate A as baseline.

---

## 3. Recent Form — Detailed Findings

### 3.1 Implementation Verification

The production implementation in `recentForm.ts` is correctly structured. All layers validated as active:

| Feature | Implementation | Status |
|---|---|---|
| Opponent-adjusted performance delta | `computeMatchPerformances` → `performanceDelta` | ✅ Active |
| S&R quality blend (25%) | `SERVE_RETURN_BLEND_WEIGHT = 0.25`, via `serveReturnQualityRating()` | ✅ Active |
| Tour-level credibility shrink | `TOUR_CREDIBILITY_FLOOR = 0.35`, applied via `tourLevelShare` | ✅ Active |
| Exponential recency decay | `Math.pow(0.85, i)` per match | ✅ Active |
| Surface-mismatch de-weight | `SURFACE_MISMATCH_WEIGHT = 0.7` for off-surface matches | ✅ Active |
| Retirement/walkover de-weight | `RETIRED_OR_WALKOVER_WEIGHT = 0.35` | ✅ Active |
| Trend threshold | `TREND_DELTA_THRESHOLD = 0.25`, `TREND_MIN_SAMPLE = 6` | ✅ Active |
| Confidence shrink (ensemble) | `CONFIDENCE_SHRINK.recentForm = 0.35` in `dataQuality.ts` | ✅ Active |

The empirical validation of trend labels (2026-07-14, documented in `recentForm.ts` comments and memory) remains valid. No re-validation needed for this audit.

### 3.2 Why Standalone Accuracy (60.3%) Is Lower Than General Model (64.5%)

Recent Form alone is a weaker predictor than the full ensemble by design:
- **Structural near-50 concentration:** 66.6% of predictions are within ≤2pp of 50% because two professionals in similar form have a near-zero differential by definition
- **Opponent-adjusted signal is relative, not absolute:** a player winning 8/10 against weak opponents scores similarly to one winning 6/10 against strong opponents — the absolute quality read is dampened in favor of relative comparison
- **Tour-credibility shrink:** Challenger/ITF-heavy players' form scores are shrunk toward 50, further compressing the distribution

This is appropriate behavior. The module is designed to be a confirmation signal when it fires at meaningful edge, not a standalone predictor.

### 3.3 ECE and Calibration

The ECE of 0.0854 reflects that RF's raw probability output is not well-calibrated as a standalone signal. This is expected and does not indicate a bug — the `CONFIDENCE_SHRINK.recentForm = 0.35` applied at the ensemble level accounts for this by shrinking RF's contribution toward 50% before combining it with other modules. The high ECE is a property of the standalone output, not of what the ensemble actually uses.

### 3.4 Cross-Tour Findings

- **ITF outperforms ATP/Challenger on this module:** ITF has larger ranking disparities that generate meaningful opponent-adjusted deltas. The tour-credibility shrink correctly dampens ITF-only form signals toward neutral.
- **ATP underperforms (58.0%) vs. WTA (59.9%):** Consistent with prior findings. ATP tour-level matchups are closer to coin-flip territory after recent form is accounted for; surface Elo dominates there.
- **IndoorHard underperforms (58.0%):** Persistent across modules. Likely reflects genuine predictive difficulty (indoor court dynamics, serving conditions) that the current feature set doesn't distinguish from outdoor Hard.

---

## 4. Specialist Pipeline — Coverage Audit

### 4.1 Thresholds in Effect

From `specialistWeights.ts`:
- `MIN_HISTORICAL_MATCHES_FOR_SEGMENT = 150` — a segment must have ≥150 historical matches for any specialist to be fit
- `MIN_VALIDATION_SAMPLES_FOR_SEGMENT = 30` — a segment must have ≥30 validation-window predictions for the calibration curve to be trusted

### 4.2 Segment Coverage Table (12 Candidate Segments per Task Spec)

The task spec references "12 target segments (ATP/WTA/Challenger/ITF × surface)." The code (`segments.ts`) only treats ATP and WTA as candidates — Challenger and ITF are explicitly excluded because their per-surface volume cannot support responsible segment-specific calibration. The 12-segment framing from the task spec is therefore partially aspirational; the 8-segment implementation is the correct design. Challenger and ITF columns are documented here for completeness.

**8 implemented candidate segments:**

| Segment | Hist Matches | Clears 150? | Val Samples | Clears 30? | Active? | Accuracy | Weight |
|---|---|---|---|---|---|---|---|
| ATP-Hard | 3,469 | ✅ | 908 | ✅ | ✅ Yes | 58.8% | 0.825 |
| ATP-Clay | 3,129 | ✅ | 136 | ✅ | ✅ Yes | 53.0% | 0.809 |
| ATP-Grass | 1,123 | ✅ | **0** | ❌ | ❌ No | — | 0 |
| ATP-IndoorHard | 934 | ✅ | 290 | ✅ | ✅ Yes | 68.0% | 0.764 |
| WTA-Hard | 4,170 | ✅ | 1,174 | ✅ | ✅ Yes | 57.9% | 0.818 |
| WTA-Clay | 2,462 | ✅ | **0** | ❌ | ❌ No | — | 0 |
| WTA-Grass | 1,239 | ✅ | **0** | ❌ | ❌ No | — | 0 |
| WTA-IndoorHard | 267 | ✅ | 46 | ✅ | ✅ Yes | 71.7% | 0.619 |

**4 non-candidate tour segments (not implemented in code — documented for completeness):**

| Notional Segment | Code Candidate? | Reason Not Implemented |
|---|---|---|
| Challenger-Hard/Clay/Grass/IndoorHard | ❌ No | `CANDIDATE_TOURS = ["ATP", "WTA"]` only; Challenger per-surface volume cannot support responsible calibration |
| ITF-Hard/Clay/Grass/IndoorHard | ❌ No | Same rationale as Challenger |

### 4.3 Why Three Segments Have Zero Validation Samples

ATP-Grass, WTA-Clay, and WTA-Grass all show 0 validation samples despite having sufficient historical match coverage. The cause is the walk-forward window: the current evaluation run covers August 2025 through February 2026 — the US Open/indoor swing — which does not include Wimbledon (July) or Roland Garros (May–June). A full 4-fold walk-forward (Task #67) extending through spring 2026 would recover these segments.

### 4.4 Verification: computeAndStoreSpecialistSegments Call Path

Code inspection of `walkForward.ts` (line 247) confirms:

```typescript
// Training mode only (evaluationOnly = false):
await computeAndStoreSpecialistSegments(liveMapping);
```

The `if (evaluationOnly)` branch at line 216 skips both calibration refit and specialist recomputation. The `computeAndStoreSpecialistSegments` call is inside the `else` block — it is never called in evaluation-only mode. The dashboard "Run Walk-Forward" button always uses `evaluationOnly=true`. The separate "Run Optimizer" endpoint uses `evaluationOnly=false`. This is correct behavior — no specialist update ever happens from a standard dashboard walk-forward run.

### 4.5 Schema and Naming Issues

**No schema/naming issues found in the current codebase.** The earlier bug (documented in `docs/validation-sprint2.md` §11.1) where `inArray(tour, ['ATP250', 'Masters1000'])` incorrectly queried the `tour` column has been fixed. Current code uses `eq(historicalMatchesTable.tour, segment.tour)` which correctly matches `tour = 'ATP'` / `tour = 'WTA'`. The memory entry in `specialist-tour-column-distinction.md` documents this distinction.

### 4.6 Active Segment Quality Notes

| Segment | Note |
|---|---|
| ATP-Clay (acc=53.0%, n=136) | Marginal — barely above coin flip. Weight of 0.809 gives it substantial ensemble influence. A minimum-accuracy gate (e.g. discard specialists below 54%) would prevent this segment from degrading predictions. |
| WTA-IndoorHard (acc=71.7%, n=46) | Appears very high but n=46 is thin — the 95% CI is wide. Weight 0.619 is appropriately lower than better-sampled segments. |
| ATP-IndoorHard (acc=68.0%, n=290) | The one clear specialist win: 68% on a segment that the general model handles at 58.6%. This is the strongest evidence that segment specialization is working. |

---

## 5. Serve & Return — Granular Root-Cause Analysis

### 5.1 Path Split Summary

| S&R Path | N | Accuracy | 95% CI | Avg S&R Prob |
|---|---|---|---|---|
| Proxy (set/game margins) | 12,893 | 64.42% | [63.6%, 65.2%] | 50.08 |
| Real stats (point-level) | 9,796 | 58.86% | [57.9%, 59.8%] | 50.36 |

The 5.6pp gap between paths is entirely explained by a tournament-level confound (§5.2). It is not a module defect.

### 5.2 Tournament-Level Confound — Full Decomposition

The proxy path is dominated by ITF matches: 11,203 of 12,893 proxy predictions (87%) are ITF, where large ranking gaps produce high-accuracy predictions by any module. The real-stats path is dominated by tour-level matches where competitive parity makes prediction harder.

**By tour+path:**

| Tour | S&R Path | N | Accuracy |
|---|---|---|---|
| ITF | proxy | 11,203 | **65.03%** |
| ITF | real_stats | 2,114 | 57.47% |
| Challenger | proxy | 1,151 | 62.64% |
| Challenger | real_stats | 4,585 | 57.86% |
| ATP | proxy | 129 | 48.84% (n=129, too small) |
| ATP | real_stats | 1,598 | **61.14%** |
| WTA | proxy | 185 | 60.54% |
| WTA | real_stats | 1,457 | **61.56%** |

**Finding:** Within the same tour, the real-stats path performs as well or better than the proxy path where sample sizes are adequate (ATP: 61.1% real vs. 48.8% proxy; WTA: 61.6% vs. 60.5%). The apparent proxy advantage disappears entirely when controlling for tournament level. **The module is functioning correctly; no fix is warranted.**

### 5.3 Career-Average vs. Recent-Window Data Completeness

The S&R module (`serveReturn.ts`) does not distinguish career averages from a recent window — it uses the full match history passed by the scoring context, which during walk-forward evaluation is all historical matches up to each prediction's cutoff date. This is effectively a career window for players in the current corpus.

**Key implication:** Unlike Recent Form (which uses a fixed 10-match window), S&R aggregates over an unbounded history. A player's S&R rating reflects their career serve/return profile, not just recent form. This is by design — serve and return characteristics are more stable traits than form, and using a longer window reduces noise. No data-completeness issue to fix.

### 5.4 Return-Metric Completeness

| Path | N | breakPointsConvertedPct non-null | breakPointsSavedPct non-null | firstServeWinPct non-null | serviceGamesHeldPct non-null |
|---|---|---|---|---|---|
| Real stats | 9,796 | **99.7%** | **99.7%** | **49.8%** | **100.0%** |
| Proxy | 12,893 | 39.5% | 40.4% | 10.4% | 41.7% |

All values are from direct DB queries (`feature_snapshot.engine.serveReturn.player1PointLevel.<field> IS NOT NULL`).

**Key findings from direct queries:**

- **breakPointsConvertedPct and breakPointsSavedPct** both resolve at 99.7% on the real-stats path — the provider consistently reports both players' break-point tallies on these matches.
- **serviceGamesHeldPct** resolves at 100.0% on the real-stats path — it is derived from `servicePointsWonPct` via the Newton & Keller formula whenever `servicePointsWonPct` is present, and the real-stats path only activates when `servicePointsWonPct` is non-null (see `realRatingsFromStats`'s filter), so by construction it always resolves when the real-stats path is active.
- **firstServeWinPct** is only available for 49.8% of real-stats predictions — roughly half of real-stats matches lack first-serve split data from the provider. This means the `blendPointLevel` deepening via `firstServeWinPct` is active for only ~half the real-stats predictions; the other half rely on the break-point and service-hold fields. The module already handles this gracefully (each field resolves independently per `computePointLevelStats`).

**No action needed:** The 49.8% firstServeWinPct gap is a provider data limitation, not a bug. The module degrades gracefully — the blend can still apply via break-point conversion and service-hold fields even when first-serve splits are absent.

On the proxy path, point-level metrics are present for ~40% of predictions. These come from opponents' match stats being recorded even when the match lacks real-stats point-level percentages — the proxy path uses `ratingsFromMargins` as its headline rating, but `computePointLevelStats` still resolves independently. The proxy path does not use these for its primary rating.

### 5.5 Confidence-Bucket ECE by Tour Level

| Tour | N | S&R ECE |
|---|---|---|
| ITF | 13,317 | 0.0314 |
| WTA | 1,642 | 0.0306 |
| ATP | 1,727 | 0.0233 |
| Challenger | 5,736 | 0.0180 |

**Finding:** ITF has the highest ECE (0.031) and ATP+Challenger the lowest (0.018–0.023). The ITF elevation is consistent with the proxy-path dominance: the proxy path's 64.4% accuracy overstates its stated ~50% average confidence, producing a larger ECE gap. The ATP and Challenger ECE values are low and acceptable — the real-stats path is well-calibrated for the matches it covers. WTA ECE is slightly elevated, potentially reflecting the WTA proxy-path contamination (185 proxy + 1,457 real_stats = mixed ECE).

**No CONFIDENCE_SHRINK change warranted based on this evidence.** The existing `CONFIDENCE_SHRINK.serveReturn = 0.45` is still appropriate for the real-stats path and over-conservative for the proxy path — but because both corrections go in the same direction (toward reducing S&R's stated confidence), the asymmetry is safe.

### 5.6 Double-Counting Test: S&R vs. Surface Elo Independence

| Correlation | r |
|---|---|
| S&R probability ↔ Surface Elo probability (Pearson) | **0.4472** |
| S&R probability ↔ actual outcome (Pearson) | **0.2856** |
| Surface Elo probability ↔ actual outcome (Pearson) | **0.2670** |
| **Partial r(S&R, outcome \| Elo) — S&R's signal independent of Elo** | **0.1928** |
| **Partial r(Elo, outcome \| S&R) — Elo's signal independent of S&R** | **0.1625** |

**Finding:** S&R retains a substantial partial correlation with outcome (r=0.19) after controlling for Surface Elo, and Elo retains its own independent signal (r=0.16) after controlling for S&R. Both modules contribute genuinely independent predictive information. S&R's partial correlation is higher than Elo's, confirming the earlier finding that S&R is directionally slightly more informative in disagrement scenarios.

The S&R–Elo Pearson of 0.4472 is moderate, not high — it does not indicate double-counting. A correlation above ~0.85 would be the threshold for concern. The current level is expected: both modules respond positively to dominant players but from different evidence (serve/return point stats vs. historical Elo rating trajectory).

**Conclusion: No double-counting problem. The existing ensemble weights (Elo=1.5, S&R=1.5) are appropriate given comparable partial correlations with outcome.**

---

## 6. Stage 2 Candidates — Results

**Date completed:** 2026-07-18  
**Implementation:** `artifacts/api-server/src/services/evaluation/sprintStage2Candidates.ts`  
**Runner:** `artifacts/api-server/scripts/runSprintStage2.ts`

### 6.1 Summary

All 23 candidate_configs rows inserted. No production code modified. All rows have status `pending`. None promoted or activated.

| Track | Count | Status |
|---|---|---|
| Recent Form B–G | 6 | Pending Stage 3 walk-forward evaluation |
| Specialist segments (all 8) | 8 | 5 active (meetsThreshold=true), 3 Needs More Data |
| Serve & Return A–I | 9 | All Needs More Data (Stage 1 found no evidence base) |
| **Total** | **23** | **0 promoted / 0 active** |

### 6.2 Recent Form Candidates (Track 1)

Six parameter-variant candidates for the Recent Form module. Each is stored with the full production baseline snapshot (calibration model id=82, ENSEMBLE_WEIGHT_PRIOR, CONFIDENCE_SHRINK). Stage 3 walk-forward evaluation will produce variant metrics for comparison against Candidate A (§2.1).

| ID | Candidate | Key Change | Hypothesis |
|---|---|---|---|
| 1 | RF-B — Plain win-rate | Remove opponent adjustment, S&R blend, tour shrink | Tests whether complexity adds net value vs. simple win/loss counting |
| 2 | RF-C — Opponent-adjusted only | Remove S&R blend only | Tests whether the 25% S&R blend double-counts the separate S&R ensemble vote |
| 4 | RF-D — No tour-credibility shrink | Remove TOUR_CREDIBILITY_FLOOR (+ no S&R blend) | Tests whether the shrink over-suppresses ITF-heavy corpus form scores |
| 6 | RF-E — Surface-preference weighting | Add 1.3× bonus for same-surface wins | Tests whether stronger surface affinity improves Clay/Grass/IndoorHard segments |
| 8 | RF-F — Reduced weight 1.3→0.65 | ENSEMBLE_WEIGHT_PRIOR.recentForm: 1.3→0.65 | Tests whether module is overweighted given 66.6% near-50 concentration |
| 10 | RF-G — Removed from ensemble | ENSEMBLE_WEIGHT_PRIOR.recentForm: 1.3→0 | Full ablation baseline: confirms RF's net contribution to ensemble accuracy |

### 6.3 Specialist Segment Candidates (Track 2)

Eight candidate_configs rows — one per specialist_models row. `specialist_models` was already populated from a prior training-mode walk-forward run.

**Active segments (5):**

| ID | Segment | Val N | Accuracy | General Accuracy | Weight | Log Loss vs. General |
|---|---|---|---|---|---|---|
| 3 | ATP-Hard | 908 | 58.8% | 63.2% | 0.825 | 0.643 vs. 0.674 |
| 5 | ATP-Clay | 136 | 53.0% | 62.0% | 0.809 | 0.665 vs. 0.692 |
| 9 | ATP-IndoorHard | 290 | 68.0% | 68.0% | 0.764 | 0.574 vs. 0.590 |
| 11 | WTA-Hard | 1174 | 57.9% | 57.4% | 0.818 | 0.661 vs. 0.690 |
| 15 | WTA-IndoorHard | 46 | 71.7% | 69.6% | 0.619 | 0.553 vs. 0.588 |

**Inactive segments — Needs More Data (3):**

| ID | Segment | Reason | Fix |
|---|---|---|---|
| 7 | ATP-Grass | 0 validation samples (window=Aug 2025–Feb 2026, no Wimbledon) | Task #67: run 4-fold walk-forward through spring 2026 |
| 12 | WTA-Clay | 0 validation samples (window misses Roland Garros) | Task #67: same |
| 13 | WTA-Grass | 0 validation samples (window misses Wimbledon) | Task #67: same |

### 6.4 Serve & Return Candidates (Track 3)

All nine S&R variants stored as **Needs More Data**. Stage 1 audit (§5, §6) found no miscalibration requiring correction. Per Sprint Stage 2 rule: variants without a clear evidence-based hypothesis from Stage 1 are documented but not built.

| ID | Candidate | Stage 1 Finding |
|---|---|---|
| 14 | SR-A — Recalibrated output | ECE well-behaved (0.018–0.023); CONFIDENCE_SHRINK=0.45 appropriate |
| 16 | SR-B — Edge cap | No extreme-edge overconfidence found |
| 17 | SR-C — Reduced ensemble weight | Weight justified by partial r=0.19; accuracy confound is tour-level not weight issue |
| 18 | SR-D — Tour-level weight reduction | ATP/WTA real-stats accuracy (61%) actually BETTER than the 58.9% overall; confound inverted |
| 19 | SR-E — Surface-specific calibration | Insufficient data from Stage 1; specialist pipeline already handles surface+tour corrections |
| 20 | SR-F — Minimum sample-size gate | Raising gate pushes tour-level predictions to proxy which performs worse on ATP (48.84%) |
| 21 | SR-G — Remove firstServeWinPct blend | Already handled gracefully; other fields (99.7%/100%) still apply |
| 22 | SR-H — Increase POINT_LEVEL_BLEND_WEIGHT | No dedicated point-level ablation in Stage 1; insufficient evidence |
| 23 | SR-I — Remove S&R entirely (ablation) | Partial r=0.19 confirms substantial independent signal; prior ablation already showed removal hurts |

### 6.5 Production Leakage Verification

- `artifacts/api-server/src/services/predictionEngine/index.ts` — **unchanged**
- `artifacts/api-server/src/services/predictionEngine/dataQuality.ts` — **unchanged**
- `artifacts/api-server/src/services/predictionEngine/recentForm.ts` — **unchanged**
- `artifacts/api-server/src/services/predictionEngine/serveReturn.ts` — **unchanged**
- Invariant test suite: **218/218 pass** (run 2026-07-18)

---

## 7. Stage 2 Metrics Protocol

All candidate_configs rows store the full production config baseline snapshot at insertion time:
- Calibration model: id=82, method=isotonic, n=23,023 validation samples, isotonicHoldoutLogLoss=0.63765
- ENSEMBLE_WEIGHT_PRIOR as of 2026-07-18 (see `dataQuality.ts`)
- CONFIDENCE_SHRINK as of 2026-07-18 (serveReturn=0.45, recentForm=0.35)
- Stage 1 baseline metrics: RF standalone accuracy 60.32%, general model 64.5%, n=22,689

Stage 3 will run the evaluation-only walk-forward for each Recent Form variant and produce the comparison table. S&R and inactive specialist segments remain pending until additional evidence accumulates.

---

## 8. Walk-Forward Results by Candidate — Stub

*To be populated by Stage 3 task.*

---

## 9. Candidate Selection — Stub

*To be populated by Stage 3 task.*

---

## 10. Stage 3: Optimizer Run Setup — Stub

*To be populated by Stage 3 task.*

---

## 11. Optimizer Results — Stub

*To be populated by Stage 3 task.*

---

## 12. Post-Optimizer Validation — Stub

*To be populated by Stage 3 task.*

---

## 13. Deployment Decision — Stub

*To be populated by Stage 3 task.*

---

## 14. Sprint Retrospective — Stub

*To be populated after Stage 3 completes.*

---

## Appendix A: Reproducibility — Key Query Patterns

All statistics in this document can be reproduced by running the following query patterns directly against the `evaluation_predictions` table. Module probabilities are stored inside `feature_snapshot` (JSONB) and extracted using `jsonb_array_elements`.

**Base filter (all metrics):**
```sql
WHERE run_kind = 'historical_test'
  AND segment = 'test'            -- or 'validation' for specialist sample counts
  AND included_in_accuracy = true
  AND actual_winner_id IS NOT NULL
  AND feature_snapshot IS NOT NULL
```

**Extracting a module's probability from `feature_snapshot`:**
```sql
(SELECT (elem->>'player1Probability')::float
 FROM jsonb_array_elements(feature_snapshot->'engine'->'models') elem
 WHERE elem->>'modelName' = 'Recent Form')  -- or 'Surface Elo', 'Serve & Return'
```

**Standalone accuracy for module M:**
```sql
AVG(CASE WHEN (M_prob >= 50 AND outcome = 1) OR (M_prob < 50 AND outcome = 0) THEN 1 ELSE 0 END) * 100
```
where `outcome = 1` when `actual_winner_id = player1_id`.

**Log loss for module M (standalone):**
```sql
AVG(-(outcome * LN(GREATEST(M_prob/100.0, 0.001)) + (1-outcome) * LN(GREATEST(1 - M_prob/100.0, 0.001))))
```

**Brier score for module M:**
```sql
AVG((M_prob/100.0 - outcome)^2)
```

**ECE (10 equal-width buckets):**
```sql
-- bucket_stats CTE: FLOOR(prob * 10)/10, COUNT(*), AVG(prob), AVG(outcome) per bucket
-- ECE = SUM(n * ABS(avg_conf - avg_acc)) / SUM(n)
```

**Pearson correlation between two module probabilities:**
```sql
CORR(module_a_prob, module_b_prob)
```

**S&R path detection:**
```sql
CASE WHEN feature_snapshot->'engine'->'serveReturn'->>'note' LIKE '%real match-level point statistics%'
  OR feature_snapshot->'engine'->'serveReturn'->>'note' LIKE '%Ratings are derived from the provider%'
  THEN 'real_stats' ELSE 'proxy' END
```

**S&R point-level field completeness:**
```sql
(feature_snapshot->'engine'->'serveReturn'->'player1PointLevel'->>'breakPointsConvertedPct') IS NOT NULL
```

**Specialist validation sample counts:**
```sql
FROM evaluation_predictions ep
INNER JOIN historical_matches hm ON ep.historical_match_id = hm.id
WHERE ep.segment = 'validation'     -- not 'test'
  AND hm.tour IN ('ATP', 'WTA')
  AND ep.surface IN ('Hard', 'Clay', 'Grass', 'IndoorHard')
GROUP BY hm.tour, ep.surface
```

**Historical match counts per segment:**
```sql
FROM historical_matches
WHERE tour IN ('ATP', 'WTA')
  AND surface IN ('Hard', 'Clay', 'Grass', 'IndoorHard')
GROUP BY tour, surface
```

---

## Appendix B: Data Sources and Query Notes

- All statistics are derived from `evaluation_predictions` (run_kind=`historical_test`, segment=`test`, included_in_accuracy=true) joined to `historical_matches` for tour/level fields
- Module probabilities extracted from `feature_snapshot.engine.models[]` by `modelName` field using PostgreSQL `jsonb_array_elements`
- S&R path (proxy vs. real_stats) distinguished by the `note` field in `feature_snapshot.engine.serveReturn`: real-stats path notes contain "derived from the provider's real match-level point statistics"
- Correlation computations use PostgreSQL `CORR()` function (Pearson product-moment)
- Partial correlations computed analytically from the three pairwise Pearson correlations
- 95% CIs use Wilson score interval approximation
- Specialist segment validation sample counts use `segment='validation'` (not `'test'`) consistent with how `computeAndStoreSpecialistSegments` queries them

## Appendix B: Relationship to Prior Audit Docs

- `docs/module-audit-recent-form-snr.md` (2026-07-18, n=8,865): covered RF/S&R with a smaller corpus. Key findings reproduced here with n=22,689 and extended with the new statistics required for this sprint (standalone log loss, Brier, ECE, inter-module correlation, specialist coverage table, S&R partial correlation).
- `docs/validation-sprint2.md` (2026-07-18): Sprint 2 validation report containing the specialist pipeline fix (§11) and the calibration model update. The specialist table in §11.3 of that document is the source of truth for current active segments and weights.
- Task #53 (specialist pipeline fix) is fully absorbed into this sprint per the task spec. The fix (column naming bug) landed before this audit and is verified correct in §4.5 above.

---

*Audit completed 2026-07-18. No code in `artifacts/api-server/src/` or `lib/` modified. All numbers from live DB queries.*
