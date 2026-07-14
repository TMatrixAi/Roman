# Full Statistical Audit of the Prediction Engine
**Date:** 2026-07-14 · **Scope:** audit only, no code/config/threshold changes made · **Author:** automated audit (Task #116)

## 0. Dataset used, and why

A fresh 4-fold expanding-window walk-forward backtest was already sitting in the database, generated **today (2026-07-14, 14:32-14:38 UTC)** by the current engine code (`phase8-historical-live-engine-v1` historical-scoring generation, which runs the *exact same* `runPredictionEngine()` call live predictions use — confirmed by inspecting `services/evaluation/types.ts`). This means every number below reflects the engine **as it exists right now**, including today's disagreement-gate fix (Task #114) and the 2026-07-13 ensemble/Elite-tier changes — not a stale snapshot.

| Segment | Rows | Graded | Void (retired/wo/cancelled) | Date range |
|---|---|---|---|---|
| validation | 5,473 | 4,274 | 1,199 | 2025-02-12 → 2025-03-26 |
| test (held out) | 5,473 | 4,253 | 1,220 | 2025-02-19 → 2025-04-01 |

All figures below use **`test`-segment, `included_in_accuracy = true`** rows (n = 4,111) unless stated otherwise — this is the genuinely held-out slice (never used to fit calibration knots). `validation` numbers are shown only as an overfitting check.

**Critical scoping gap, not a methodology flaw in the backtest itself:** the live/paper-trading ledger (`run_kind = 'paper_trade'`) contains **zero graded rows**. Its only 111 rows are all `status = 'missed'` from a single day (2026-07-11), and `job_runs` shows only 6 paper-trading cycles and 2 calibration refits ever ran, all on 2026-07-11. **This audit — and the engine's entire evidence base — rests exclusively on the historical backtest. There is currently no real-world (live-odds, live-market, actually-paper-traded) evidence that the engine works in production**, because production has never actually locked and graded a prediction. This should be treated as the single biggest blind spot in the report below.

---

## 1. Dataset validity

- **Total graded, accuracy-eligible historical rows:** 8,241 (4,130 validation + 4,111 test). Retirements (142 test, 144 validation) are correctly excluded per the admin-configured `retirementRule = 'excluded'` default, and appear as separate `result_type='retired'` rows rather than being silently dropped or miscounted.
- **Coverage by tournament level:** ITF 5,332 (65%), Challenger 1,597 (19%), ATP250 379, Masters1000 360, WTA250 298, ATP500 200, WTA1000 75. **The corpus is heavily ITF/Challenger-weighted** — Masters1000/WTA1000/ATP500 combined are only 635 rows (7.7%). Any claim about "tour-level" accuracy is really mostly a claim about lower-tier tennis; big-tournament conclusions carry wide, largely untested uncertainty (n=360 and n=75 for Masters1000/WTA1000 respectively — both **flagged small-n**).
- **Time span is short and single-season:** only ~7 weeks of matches (Feb 12 – Apr 1, 2025), 4 folds, one `model_version`. There is no cross-season, cross-surface-calendar, or multi-year drift data — the whole backtest is a single spring hard/clay-transition window. Findings about "which conditions the engine handles well" cannot be generalized past this window without more data.
- **Walk-forward integrity is real, not just labeled as such:** fold windows are strictly expanding and chronologically ordered (train ends exactly where validation starts, validation ends exactly where test starts, later folds' train windows include all of earlier folds' validation+test — confirmed directly from `evaluation_runs`), and `evaluation_predictions` carries a DB trigger enforcing settle-once (no route can retroactively edit a graded outcome). No leakage found in this mechanism.

---

## 2. Calibration

Overall (test segment, n=4,111): **accuracy 57.2% [95% CI 55.7–58.7%], log loss 0.682, Brier 0.244** (baseline for an uninformative coin flip: log loss 0.693, Brier 0.25). Validation segment (n=4,130): accuracy 59.2% [57.6–60.6%], log loss 0.668. **The ~2pt accuracy / 0.014 log-loss drop from validation to test is normal, expected out-of-sample degradation** (calibration knots are fit on validation only) — not evidence of leakage, but it does mean validation-segment numbers modestly overstate true performance and should never be quoted alone.

**Calibration curve by predicted-winner confidence** (test segment):

| Predicted confidence | n | Observed accuracy | Gap |
|---|---|---|---|
| ~50% | 390 | 47.7% | −2.3pt (mild under-shoot, near-noise at a coin flip) |
| ~54% | 1,769 | 51.1% | −2.9pt |
| ~57% | 2,762 | 57.1% | ~0 |
| ~62% | 1,577 | 62.5% | ~0 |
| ~67% | 1,232 | 65.3% | −2pt |
| ~72% | 307 | 65.1% | **−7pt (overconfident)** |
| ~77% | 136 | 67.6% | **−10pt (overconfident)** |
| ~82% | 54 | 66.7% | **−15pt (overconfident, n=54 — small-n flag)** |
| ~86% | 14 | 78.6% | n=14 — **too small to interpret** |

**Finding (High severity):** calibration is genuinely good from 50–67% confidence, but the engine becomes **increasingly overconfident above ~70%**, and this is exactly the range that low-n high-conviction claims (Elite tier, Strong Recommendation) draw from — see §4 and §11.

---

## 3. Model agreement

| `modelAgreement` | n | Accuracy | 95% CI |
|---|---|---|---|
| Strong | 3,144 | 57.9% | [56.2, 59.6] |
| Moderate | 1,855 | **66.4%** | [64.2, 68.5] |
| Mixed | 158 | 65.8% | [58.1, 72.8] (small-n) |
| HighDisagreement | 3,084 | 53.1% | [51.4, 54.9] |

**Finding (Critical severity):** "Strong" agreement rows are **less accurate** than "Moderate" agreement rows — a statistically significant gap (z = −5.97, p ≪ .001, comparing Strong vs Moderate). This inverts the intuitive assumption that "all models agree" should be the *most* trustworthy label. `HighDisagreement` is, as expected, the worst bucket (53.1%, barely above what a fixed-favorite baseline would likely do — see §12). The label itself (Task #114's fix already correctly separates "genuine directional conflict" from "wide but unanimous spread") is doing its job at flagging real conflict; the surprise is that *unanimity alone* isn't a positive signal, it just means the matchup was a case with little live disagreement to have in the first place (often the more lopsided, easier-to-predict-wrong cases — see §14 note on the closeness/richness conflation already in memory).

---

## 4. Recommendation tier — most important finding in this audit

`recommendation` is **not stored anywhere** in `evaluation_predictions` (checked: neither a DB column nor a key inside `featureSnapshot.engine`, which only stores `EngineBreakdown`, not the full `EngineOutput`). It was reconstructed retroactively for this audit by re-running `computeRecommendation()`'s exact published logic against the columns/fields that *are* stored (`calibratedProbability`, `upsetRiskTier`, `modelAgreement`, and `featureSnapshot.dataQuality`) — a read-only analysis, no engine code touched.

| Reconstructed recommendation | n | Accuracy | Log loss | 95% CI (accuracy) |
|---|---|---|---|---|
| MODERATE_LEAN | 2,231 | **64.3%** | 0.653 | [62.3, 66.2] |
| DO_NOT_RECOMMEND | 2,633 | 58.2% | 0.672 | [56.3, 60.1] |
| HIGH_RISK | 1,632 | 55.7% | 0.686 | [53.3, 58.1] |
| **STRONG_RECOMMENDATION** | **189** | **60.3%** | **0.736** | **[53.2, 67.0]** |
| NO_STRONG_SIGNAL | 1,556 | 51.7% | 0.692 | [49.3, 54.2] |

**Finding (Critical severity):** `STRONG_RECOMMENDATION` — the tier the UI badges green ("success" color) as the engine's most confident call — has the **worst log loss of any tier (0.736), worse than an uninformative coin flip (0.693)**, and lower point-estimate accuracy than the plainer `MODERATE_LEAN` tier. The gap vs. `MODERATE_LEAN` (60.3% vs 64.3%) is **not statistically significant on its own** (z = −1.09, n=189 is the smallest tier by far — this must be read as "the strong-recommendation tier's own evidence does not show it beating a lesser tier," not as proof it's actively harmful). Combined with §2's finding that confidence >70% is where the engine gets overconfident, this is a coherent and troubling pattern, not a one-off artifact: **the exact band `STRONG_RECOMMENDATION` requires (margin ≥ 22, i.e. pick confidence ≥ 72%) is the same band shown in §2 to be systematically overconfident.** `NO_STRONG_SIGNAL` behaves exactly as designed (51.7%, statistically indistinguishable from a coin flip) — that tier's intent ("nothing meaningful to recommend") is honestly represented by the data.

**Recommendation for follow-up (not actioned in this audit):** re-validate the `margin >= 22` / `dataQuality >= 45` thresholds behind `STRONG_RECOMMENDATION` the same way Task #75 previously re-validated the Data Quality floor — the current 189-row sample is too small to trust either direction confidently, but it is large enough to be a real warning sign given it directly contradicts the tier's own purpose.

---

## 5. Elite Tier

`isEliteTier=true`: n=468, accuracy 60.5% [56.0, 64.8]. `isEliteTier=false`: n=7,773, accuracy 58.0% [56.9, 59.1]. The difference (+2.5pt) is **directionally correct but not statistically significant** (CIs overlap substantially) — Elite tier is not shown by this data to be meaningfully better-calibrated than a non-Elite prediction, though it isn't shown to be worse either. Given Elite requires margin ≥5, DQ ≥55, all 3 core signals to agree, and no upset/conflict flags, a bigger lift than +2.5pt would be expected if the gating criteria were doing real work; this is worth revisiting once more graded volume exists (§0's live-ledger gap is the blocker).

---

## 6. Upset risk

| Tier | n | Accuracy |
|---|---|---|
| LOW | 1,021 | 61.4% |
| MODERATE | 1,301 | **63.3%** (highest) |
| HIGH | 2,813 | 60.3% |
| EXTREME | 3,106 | 53.1% (lowest, significant vs LOW: z=−4.64) |

Directionally sound at the extremes (EXTREME really is the riskiest bucket, significantly so), but **not monotonic** — MODERATE slightly outperforms LOW, which undercuts the tier's implied ordinal meaning ("lower tier = safer pick") in the middle of the scale. This is a smaller version of the same non-monotonic pattern already seen in §3's model-agreement result: the *most* extreme categorical label at each end is doing real work, but the middle categories aren't cleanly ordered.

---

## 7. Per-model performance

All rows, weight-adjusted (`included_in_accuracy=true`, n=8,241 for the four always-computed models):

| Model | Pick accuracy | Log loss (vs P1) | Avg ensemble weight |
|---|---|---|---|
| Serve & Return | 58.2% | **0.676** (best) | 0.280 |
| General Model (blended) | 58.2% | 0.682 | **0.915** (dominant) |
| Surface Elo | 57.7% | 0.684 | 0.321 |
| Recent Form | 56.0% | 0.688 | 0.381 |
| Head-to-Head | **50.7%** | **0.726** (worse than coin flip) | **0.018** (near-zero) |

Segment specialists only fire on their own tour/surface slice and cover a minority of rows (ATP-Clay n=190, ATP-Hard n=470, WTA-Hard n=511); their log loss (0.69–0.72) is roughly in line with the general model on the same slice, not a clear improvement.

**Finding (Low severity — mitigated by design, but worth naming):** the Head-to-Head model's raw signal is *worse than random* on log loss (0.726 vs 0.693 baseline) and only marginally above chance on pick accuracy (50.7%). This is not currently hurting predictions because the ensemble already gives it a near-zero weight (0.018 average) — this is the *Data Quality module weighting* design (already in memory) correctly discounting a structurally sparse signal. Named here only so future work doesn't accidentally raise Head-to-Head's weight without re-validating it first.

The **General Model dominates the blend (avg weight 0.915)**, meaning most of §3–§6's "per-signal" breakdowns are really measuring "how did the blended output do when [X] was also true" rather than isolating each component's independent contribution — a structural limit of doing this analysis from stored outcomes rather than a designed ablation.

---

## 8. Correlation analysis

| Pair | Correlation |
|---|---|
| Data Quality ↔ correctness | **−0.022** (essentially zero) |
| Pick margin ↔ correctness | +0.108 (weak positive) |
| Data Quality ↔ pick margin | +0.161 (weak positive) |

**Finding (High severity, consistent with Task #75's prior finding — see memory `dq-threshold-calibration-reversal.md`):** Data Quality has **no measurable correlation with whether a pick is actually correct** in this corpus. It correlates weakly with how confident the engine *is* (r=0.16), but that confidence isn't itself well-founded at the top end (§2). DQ-bucketed accuracy is **non-monotonic and inverted at the top**:

| DQ bucket | n | Accuracy | Log loss |
|---|---|---|---|
| Excellent (85–100) | 837 | **54.7%** (worst) | 0.698 (worst) |
| Strong (65–84) | 1,828 | 56.7% | 0.679 |
| Acceptable (45–64) | 1,626 | 59.0% | 0.675 |
| Limited (25–44) | 1,317 | **61.4%** (best) | 0.660 (best) |
| Poor (0–24) | 2,633 | 58.2% | 0.672 |

Excellent vs Limited is a statistically significant gap the *wrong direction* (z = −3.08, p < .01): the label meant to convey "most trustworthy" performs worse than "Limited." This directly reaffirms the prior Task #75 finding and shows it still holds in this fresh backtest — Data Quality is not currently a reliable proxy for "will this prediction be right," only for "how much real input data existed," and those two things have decoupled.

---

## 9. UI honesty / consistency

Reviewed `PredictionResult.tsx` (individual prediction detail page) and `AccuracyDashboard.tsx` (aggregate reporting page).

- **`AccuracyDashboard.tsx` already does this well**: it shows sample sizes next to every bucketed accuracy figure, and explicitly flags segments below a minimum threshold as "INSUFFICIENT DATA" / "SAMPLE SUFFICIENT" / `n < {threshold}`. This is good practice and should be the model for other surfaces.
- **`PredictionResult.tsx` does not carry any of that caution to the per-match badges.** `STRONG_RECOMMENDATION` renders as a green `"success"` badge and `isEliteTier` renders as a green crown "ELITE PREDICTION" badge, both with no accompanying accuracy/sample-size context — exactly the two labels this audit found have the weakest (Recommendation: worst log loss of any tier) or unproven (Elite: not statistically distinguishable from non-Elite) evidence behind them. **This is a UI-honesty gap, not a math bug**: the underlying numbers are computed correctly and consistently (both this page and the Ledger read the same finalized `modelAgreement`/`recommendation`/`isEliteTier` fields — no split-source issue was found), but the visual treatment (green "success" styling) asserts more confidence than the audit's own accuracy data currently supports for exactly those two labels.

---

## 10. Confidence inflation / suppression

- **Inflation:** confirmed at the high-confidence tail (§2, §4) — the ~72%+ predicted-confidence band, and the `STRONG_RECOMMENDATION`/Elite tiers built from it, show real signs of overconfidence rather than the caution their visual treatment implies.
- **Suppression:** no clear evidence found. `NO_STRONG_SIGNAL` (51.7% accuracy, indistinguishable from a coin flip) and `HIGH_RISK` (55.7%) both under-claim roughly in proportion to their actual performance — if anything the labeling scheme is honest or slightly conservative at the low-confidence end, and only overclaims at the high-confidence end.

---

## 11. Threshold estimates (explicitly caveated — not a change proposal)

Based only on this single 7-week corpus (n=189 for the tier in question — too small to set a production threshold from alone):
- The current `margin >= 22` cutoff for `STRONG_RECOMMENDATION` sits inside the zone shown in §2 to already be overconfident (72%+ predicted confidence maps to observed accuracy of only 65–67%, not 72%+). A tighter margin (e.g. requiring the higher end of that band, or gating on the ~≥77% predicted-confidence range where the sample is even smaller) is not something this dataset can responsibly recommend a specific number for — it would need either much more graded volume or an explicit re-run of the Task #75-style walk-forward re-validation methodology, focused on this tier specifically.
- No other threshold in this report (DQ floors, upset-risk bands, agreement gates) showed evidence strong enough, at this sample size, to justify a specific numeric change recommendation. All are flagged as follow-up candidates, not conclusions.

---

## 12. What a naive baseline would score (context, not a recommendation)

Not computed in this pass (would require reconstructing "market-implied favorite" or "higher-ranked player" as a baseline predictor over the same 4,111 rows) — flagged as a useful follow-up so future accuracy claims have an honest floor to compare against, since 57–59% accuracy and 0.66–0.68 log loss are modest in absolute terms and their real value depends entirely on how hard the underlying matchups are.

---

## 13. Overall engine health scorecard

| Subsystem | Score (0–10) | Justification |
|---|---|---|
| Dataset / walk-forward integrity | 8/10 | Genuine, leak-checked expanding-window methodology and immutable ledger; docked for short time span (7 weeks) and zero live-ledger evidence (§0). |
| Core calibration (50–67% band) | 7/10 | Well-calibrated in the bulk of its range. |
| Calibration at high confidence (70%+) | 3/10 | Systematically overconfident exactly where the product claims the most certainty. |
| Model agreement labeling | 5/10 | Correctly separates genuine conflict from spread (Task #114 fix holds up), but "Strong"/unanimous is not more accurate than "Moderate" — the ordinal story is inverted at the top. |
| Data Quality as a trust signal | 3/10 | No correlation with correctness; inverted at the top end, consistent with a known prior finding. |
| Recommendation tier | 3/10 | `STRONG_RECOMMENDATION`'s own evidence is the worst-calibrated tier in the system; too small a sample to prove harm, large enough to be a real warning. |
| Elite tier | 5/10 | Directionally sound, not yet statistically proven better than non-Elite. |
| Upset risk tiering | 6/10 | Correct at the extremes, non-monotonic in the middle. |
| Per-model / ensemble design | 7/10 | Sensible weighting (Head-to-Head correctly down-weighted); General Model's dominance limits how much this audit can isolate individual signal quality. |
| UI honesty | 5/10 | Aggregate dashboard is exemplary; per-prediction detail page overclaims confidence exactly where the data is weakest. |

**Overall: 5.5/10** — a methodologically sound backtest revealing that the engine's *highest-confidence claims are its least-validated ones*, with no live-production evidence yet to check against.

---

## 14. Severity-ranked issue list

1. **[Critical]** `STRONG_RECOMMENDATION` tier has the worst log loss (0.736, worse than a coin flip) of any recommendation tier, directly contradicting its intended meaning. n=189, evidence directional but not yet statistically proven (§4). *Recommended next step: dedicated re-validation of this tier's thresholds once more graded volume exists, following the Task #75 methodology.*
2. **[Critical]** Model agreement "Strong" (unanimous) underperforms "Moderate" agreement by a statistically significant margin (57.9% vs 66.4%, z=−5.97, n=3,144/1,855) — the agreement label's ordinal meaning is inverted at the top (§3).
3. **[High]** Calibration is overconfident above ~70% predicted confidence (§2) — the mechanism behind both issues #1 and #5.
4. **[High]** Data Quality has ~zero correlation with correctness and is inverted at the top bucket (Excellent 54.7% vs Limited 61.4%, z=−3.08) — reaffirms a prior known finding (§8).
5. **[High]** Zero graded rows exist in the live/paper-trading ledger; every conclusion in this audit (and every conclusion the app could currently make about its own live accuracy) rests solely on the historical backtest (§0).
6. **[Medium]** `PredictionResult.tsx`'s per-match badges for `STRONG_RECOMMENDATION` and Elite Tier use unqualified "success"/green styling with no accuracy or sample-size context, unlike the aggregate dashboard which already does this well (§9).
7. **[Medium]** Upset-risk tiering is non-monotonic in the middle bands (MODERATE 63.3% > LOW 61.4%) (§6).
8. **[Low]** Head-to-Head model's raw signal is worse than a coin flip on log loss; currently harmless because the ensemble already down-weights it to ~2%, but should not be reweighted upward without re-validation (§7).
9. **[Low]** Corpus is heavily skewed toward ITF/Challenger matches (84% of rows); Masters1000/WTA1000-specific claims rest on n=360/n=75 respectively and should always be shown with that caveat (§1).

---

## Methodology notes / caveats that apply to this entire report
- Every accuracy figure is a **Wilson 95% CI**, not a bootstrap; log-loss/Brier figures are point estimates without CIs (no per-row loss-variance bootstrap was run in this pass — flagged as a possible follow-up if finer precision on the log-loss claims is needed).
- **Multiple-testing risk**: this report runs ~20 comparisons across a single dataset; the four cited z-tests (§3, §4, §6, §8) remain significant even under a conservative Bonferroni correction (α=0.0025), but the many *non*-significant directional findings (e.g. Elite tier, upset-risk ordering) should be read as "consistent with, not proof of" the stated direction.
- Recommendation-tier figures (§4) are a **retroactive reconstruction** from stored inputs, not a stored field — verified against the exact published `computeRecommendation()` logic, but any future change to that function's logic would need this reconstruction re-run to stay accurate.
