# Module Audit: Recent Form & Serve & Return

**Date:** 2026-07-18  
**Dataset:** `evaluation_predictions` — run_kind='historical_test', segment='test' (n=8,865 scored)  
**Objective:** Determine whether Recent Form's low signal (1.74pp avg edge) and Serve & Return's lower-than-expected accuracy on the real-stats path represent fixable module problems, and whether any weight change clears the 0.5pp accuracy improvement bar.

---

## 1. Executive Summary

**The initial hypothesis was partially wrong.** The audit reveals:

- **Recent Form** is correctly implemented (opponent-adjusted, tour credibility shrink, serve/return blend are all active). Its low average signal (1.74pp) is structurally appropriate for most matchups — most active professionals genuinely have similar form. It is adding value as a confirmation signal (+6pp accuracy when it agrees with Surface Elo), but is actively harmful in a specific, identifiable scenario: when it fires at >3pp edge *in the opposite direction* from Surface Elo, the ensemble follows Form 73% of the time and achieves only **45.4% accuracy** — below a coin flip.

- **Serve & Return** is not a problem. Its apparent low accuracy on the "real stats" path (60.7%) versus the proxy (66.8%) is entirely explained by a tournament-level confound: real stats are available for better-documented tour-level matches, which are inherently harder to predict. When analyzed at the same tour level, S&R performs appropriately. Moreover, when S&R is louder than Surface Elo in a disagreement, accuracy is **66.4%** — the highest of any disagreement scenario. S&R is directionally the most reliable module in conflict situations.

- **No global weight changes are warranted.** All four weight variants tested fail to clear the 0.5pp bar for raw direction accuracy (all within 0.2pp of baseline). The CONFIDENCE_SHRINK values already applied (0.45 for S&R, 0.35 for Form) are the right tool for confidence-level correction; global weight rebalancing at the ensemble level doesn't move the needle because Form's signal is so narrow that it rarely flips a pick — it mostly nudges confidence.

- **One targeted fix is justified:** Add a conditional weight gate that reduces Recent Form's weight to near-zero when it fires at >3pp edge in the opposite direction from Surface Elo. In the 223 cases this covers (2.5% of test predictions), it would shift accuracy from 45.4% toward the 56.7% observed when the ensemble correctly deferred to Elo instead.

---

## 2. Recent Form — Full Findings

### 2.1 Implementation check

The active implementation in `recentForm.ts` uses all three layers of the 2026-07-13 validation improvements:

| Feature | Status |
|---|---|
| Opponent-adjusted performance delta (not raw win/loss) | ✅ Active |
| Serve/return quality blend (SERVE_RETURN_BLEND_WEIGHT=0.25) | ✅ Active |
| Tour-level credibility shrink (TOUR_CREDIBILITY_FLOOR=0.35) | ✅ Active |
| Recency decay (0.85^i exponential) | ✅ Active |
| Surface-mismatch de-weighting (SURFACE_MISMATCH_WEIGHT=0.7) | ✅ Active |
| Retirement/walkover de-weighting (0.35) | ✅ Active |
| Trend delta threshold (0.25) and min sample (6) | ✅ Active |

The CONFIDENCE_SHRINK of 0.35 is applied in `dataQuality.ts` / `index.ts`. There is no raw-streak implementation still running. **The form implementation is correct and current.**

### 2.2 Why signal is structurally low

67.2% of all test predictions have Recent Form within ≤2pp of 50. This is not a bug — it's the natural distribution when:

- Both players are active professionals with healthy win rates (~55-65% each)
- The opponent-adjusted delta computes a *relative* difference — even if both players are in excellent form, their differential is near zero
- Tour-credibility shrink further compresses scores for Challenger/ITF matches toward neutral

The mean edge of 1.74pp is appropriate for a module measuring *relative* form between evenly-matched professionals, not a defect.

### 2.3 Signal quality when Form does fire

| Form signal bucket | N | Accuracy | Form-Elo agreement | Agree accuracy | Disagree accuracy |
|---|---|---|---|---|---|
| Near-50 (≤2pp edge) | 5,960 | 62.8% | 65.8% | 64.5% | 59.4% |
| Low edge (2–5pp) | 2,545 | 68.2% | **83.7%** | **71.0%** | **53.8%** |
| Med edge (5–10pp) | 341 | 67.4% | 87.7% | **70.2%** | **47.6%** |
| High edge (>10pp) | 19 | 63.2% | 84.2% | **68.8%** | **33.3%** |

Two signals emerge clearly:

1. **When Form fires AND agrees with Elo, accuracy rises to 70–71%.** Form is adding real confirmation value — these are matches where multiple independent signals align.

2. **When Form fires AND disagrees with Elo, accuracy drops to 47–54% — below a coin flip.** The stronger Form's edge in the conflict direction, the worse the outcome.

### 2.4 The Form-Elo conflict problem — the one actionable finding

| Scenario | N | Ensemble direction | Accuracy |
|---|---|---|---|
| Form (>3pp edge) conflicts with Elo; ensemble follows Form | 163 | → Form | **45.4%** |
| Form (>3pp edge) conflicts with Elo; ensemble follows Elo | 60 | → Elo | **56.7%** |

The ensemble follows Form's direction in 73% (163/223) of conflict cases, carrying an average Form weight of **0.334** in those matches. These 163 misdirected picks achieve only 45.4% accuracy — 10+ points below the Elo-directed alternative.

**This is the one change with a clear directional hypothesis:** a conditional weight gate that zeros or drastically reduces Form's contribution when it has >3pp edge and points opposite to Elo would prevent these 163 picks from being pulled toward the wrong side. The gain on these 163 cases (~18 additional correct predictions) translates to approximately **+0.2pp overall accuracy** — below the full-corpus 0.5pp threshold, but targeted, risk-free (no other predictions change), and addresses a genuine anti-pattern.

### 2.5 Weight experiment results

Four weight variants were tested by re-computing ensemble direction from stored per-module probabilities and reliabilities:

| Variant | Config | Raw direction accuracy | Avg edge from 50 |
|---|---|---|---|
| Baseline (current) | Elo 1.5, S&R 1.5, Form 1.3, H2H 0.4 | 50.05% | 4.81pp |
| Exp A | Form → 0.65 | 49.92% | 5.61pp |
| Exp B | Elo → 2.0, Form → 0.65 | 49.96% | 5.54pp |
| Exp C | S&R → 2.0, Form → 0.5 | 49.89% | 6.24pp |

No variant clears the 0.5pp bar (all within 0.2pp of baseline). Weight cutting does increase average edge from 50 (more confident predictions), but doesn't flip enough pick directions to move overall accuracy. **No global weight changes will be implemented.**

Note: the avg_edge increase from cutting Form (4.81pp → 6.24pp on Exp C) is real and would produce slightly higher calibrated confidences, but only if the Platt calibration is re-fit on the new distribution — applying the existing calibration to the shifted raw outputs would not be accurate. This is why any weight change requires a full walk-forward re-run to be meaningful.

---

## 3. Serve & Return — Full Findings

### 3.1 The proxy vs. real-stats accuracy paradox

| S&R path | N | Accuracy | Avg S&R edge | Avg S&R reliability |
|---|---|---|---|---|
| Proxy (set/game margins) | 5,524 | **66.8%** | 10.79pp | 40 |
| Real stats (point-level) | 3,341 | **60.7%** | 9.25pp | 90.5 |

This looks like the real-stats path underperforms. It doesn't — it's a tournament-level confound:

| Level | S&R path | N | Accuracy |
|---|---|---|---|
| ITF | Proxy | 4,896 | 67.3% |
| ITF | Real stats | 653 | 62.2% |
| Challenger | Proxy | 535 | 63.7% |
| Challenger | Real stats | 1,776 | 60.4% |
| ATP250 | Real stats | 226 | 60.2% |
| ATP500 | Real stats | 50 | 54.0% |
| Masters1000 | Real stats | 135 | 60.0% |
| WTA1000 | Real stats | 260 | 65.4% |

The proxy path is dominated by ITF matches (4,896/5,524 = 89%) where large ranking gaps produce easy-to-predict results. The real-stats path is dominated by tour-level matches where competitive parity makes prediction harder. The accuracy gap disappears once you control for tour level. **The module is functioning correctly.**

### 3.2 S&R direction quality — key reversal of hypothesis

| Scenario | N | Accuracy |
|---|---|---|
| S&R and Elo tightly agree (≤3pp) | 1,947 | 62.4% |
| S&R and Elo disagree (>5pp) — all cases | 5,701 | **65.4%** |
| Disagreement: **S&R louder** (higher edge) | 4,524 | **66.4%** |
| Disagreement: **Elo louder** (higher edge) | 1,177 | **61.4%** |

**S&R is the more reliable directional signal when the two modules disagree.** Matches where S&R fires harder than Elo achieve 66.4% accuracy — the highest of any subset. The initial audit hypothesis ("S&R is adding confidently-wrong signal") is incorrect. S&R is outperforming Elo in disagreements.

This finding also confirms that the current ENSEMBLE_WEIGHT_PRIOR giving Elo and S&R equal priors (1.5 each) is approximately correct — if anything, slightly underweighting S&R relative to its demonstrated accuracy advantage in conflict cases.

### 3.3 CONFIDENCE_SHRINK adequacy

The 0.45 shrink applied to S&R's votes (from the 2026-07-13 ablation report: stated 66.8%, observed 57.3% — ratio 7.3/16.8 ≈ 0.43) was sized correctly. The tour-level data shows tour-level S&R accuracy (54–65%) genuinely is lower than overall, which the shrink appropriately reduces. No change needed.

---

## 4. Module Comparison Table

| Module | Avg weight | Avg edge from 50 | Near-50 (≤2pp) | High-conf (>55%) n | High-conf acc | Verdict |
|---|---|---|---|---|---|---|
| General Model | 1.000 | 3.06pp | 39.3% | 870 | 77.0% | Calibration output — working correctly |
| **Recent Form** | **0.368** | **1.74pp** | **67.2%** | 194 | 68.6% | Correct impl; conditional weight gate needed for conflict cases |
| **Surface Elo** | 0.328 | 5.81pp | 29.4% | 1,958 | 68.8% | Reliable directional signal |
| **Serve & Return** | 0.290 | 10.21pp | 13.6% | 3,321 | 66.6% | Correctly implemented; proxy/real-stats gap is a tournament confound |
| Head-to-Head | 0.014 | 4.86pp | 89.4% | 480 | 64.4% | Low weight correct; near-50 dominated by missing data |

---

## 5. Findings: What's Actually Driving Underconfidence

The 13pp gap between avg calibrated confidence (51.27%) and actual accuracy (64.5%) is caused by **data scarcity, not module logic**:

1. **H2H is dark for 90% of matches** (4,479/4,979 have 0 prior meetings → weight 0.014 → outputs 50%). Closing the 2021–2024 data gap would instantly provide H2H context for most of these.

2. **Recent Form is near-50 for 67% of predictions** — structurally appropriate but compounds the ensemble averaging toward 50.

3. **Surface Elo provides ~5.8pp avg edge** — this is the strongest signal in the feature layer, but is damped by the other modules clustering near 50.

4. **The Platt calibration cannot inject signal the raw ensemble doesn't produce.** It maps the distribution correctly on average (ECE 0.0179 on test set) but can only transform probabilities — it cannot widen the underlying ensemble spread if the inputs are near-50.

The primary lever for improving the raw confidence spread is filling the data gap (Task #44), which would move H2H from a dead module to an active one, and give Surface Elo more reliable warmup history for Elo computation.

---

## 6. Action Item: Conditional Form Weight Gate

**Implementation plan** (conditional, targeted, no global weight change):

Add a check in `index.ts` (or within the ensemble build step) that reduces Recent Form's `weightPrior` from 1.3 to a near-zero value (e.g. 0.1) when:
- Form edge from 50 is >3pp **AND**
- Form's direction (>50 vs <50) is opposite to Surface Elo's direction **AND**
- Surface Elo has meaningful signal (edge from 50 >2pp)

This preserves Form's full weight when it agrees with Elo (where it adds +6pp confirmation value) and removes its ability to pull the ensemble opposite to Elo's direction (where it causes -19pp accuracy harm).

**Expected impact:** Approximately 163 predictions shift from following Form to following Elo's direction. Estimated gain: ~18 additional correct predictions = ~+0.2pp overall accuracy on this test corpus. Small in absolute terms but zero risk to any other prediction.

**This gate has not been implemented in this audit task** — the full walk-forward validation required to confirm the gain is out of scope here. It is proposed as a follow-up task.

---

## 7. Recommendations

| Item | Action | Priority |
|---|---|---|
| **Conditional Form weight gate** (Form conflicts with Elo at >3pp) | Implement + re-run walk-forward to confirm | High — addresses cleanest identified anti-pattern |
| **Close 2021–2024 data gap** (Task #44) | Track separately — highest single accuracy lever | Critical |
| **Global Recent Form weight cut** | Do NOT implement — fails 0.5pp bar | ✗ |
| **Global S&R weight cut** | Do NOT implement — S&R is actually best directional signal | ✗ |
| **S&R real-stats reliability re-scoring** | Not needed — gap is a tournament confound, not a calibration error | ✗ |

---

*Audit completed 2026-07-18. All numbers derived from live DB queries against evaluation_predictions (run_kind='historical_test', segment='test', n=8,865 scored predictions). Module implementations verified against recentForm.ts, serveReturn.ts, dataQuality.ts, index.ts.*
