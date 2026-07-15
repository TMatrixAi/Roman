# Task 162 Audit Findings Report

**Written:** 2026-07-15  
**Scope:** Permanent synthesized findings document covering Task #162's full prediction-accuracy audit and every prior audit it built on. No code was changed by this task — it is a report only.  
**Primary sources:** `artifacts/api-server/docs/audit-task162-full-prediction-accuracy-audit.md`, `artifacts/api-server/docs/task162-findings-plain-english-summary.md`, all prior audit docs in `artifacts/api-server/docs/`, ablation reports in `artifacts/api-server/reports/`, and fresh live-DB queries run at report time (2026-07-15).

---

## 1. Executive Status Table

| System / Feature | Status | Evidence basis |
|---|---|---|
| Final winner-selection logic | **Working correctly — one confirmed exception** | No reversed winners, no sub-50% labeled as favorite across 2,331 live rows; hidden-bug sweep clean (Task #162). Exception: the tie-break cascade (§6). |
| Core ensemble (Surface Elo, Serve & Return, Recent Form) | **Working — marginal individual contributions, combined they work** | Ablation: removing any single module changes accuracy by ≤0.9pt; together they produce 57–62% accuracy depending on corpus slice. |
| Calibration (50–67% band) | **Working correctly** | Well-calibrated in the range where 99%+ of real predictions currently fall; Platt method active (holdout log loss 0.6672 vs. isotonic 0.6687). |
| Calibration (above 70%) | **Partially verified — known overconfidence, not freshly re-testable** | Task #116 (n=4,111) and Task #120 (n=44 independent fold) both found overconfidence above ~70%; too few current rows reach that band to re-check. |
| Tie-break cascade | **Confirmed bug** | 38% of predictions go through it; every step with real sample size underperforms the non-applied baseline by 13–24 points. Tracked as Task #163. |
| Upset-risk tier ordering | **Partially verified — ordering holds on fresh data** | Correct monotonic ordering on current data (EXTREME 45.0% > HIGH 36.7% > MODERATE 34.7% > LOW 24.6%). One small local inversion at Grand Slam MODERATE/HIGH worth monitoring. |
| Model-agreement labels | **Working correctly** | HighDisagreement predicts lower accuracy (54.2% vs. 65–72% elsewhere) on current data — a real, meaningful signal. |
| Strong Recommendation | **Insufficient evidence on current data / prior evidence poorly calibrated** | Zero rows reach this tier in the current validation dataset. Prior evidence (Task #116, #120) found it had the worst log loss of any tier (0.736), traced to calibration overconfidence above ~70%. |
| Elite Prediction | **Insufficient evidence on current data** | Zero rows qualify as Elite in the current validation dataset. Gate conditions (all three core signals agree + margin ≥5 + DQ ≥55) never co-occur in the current tight confidence distribution. |
| Data Quality signal above DQ 55 | **Misleading direction reversed by fix; fix verified** | Task #75/#111 found DQ had inverted correlation with correctness above 55; the fix corrected the direction (confirmed: high-DQ now 62.5% vs. low-DQ 60.1% in fresh ablation). |
| Correlated-evidence collapse | **Fixed, verified** | `collapseCorrelatedCluster` confirmed live; HighDisagreement accuracy gap confirmed on current data (§4). |
| Shadow Replay | **No data — not yet measurable** | Zero `paper_trade_shadow` rows exist. Shadow Replay has never been run in this environment. |
| Real paper-trading volume | **Critical blind spot — still too thin** | 158 graded paper-trade rows as of 2026-07-15 (up from 5 at time of Task #162's audit, after API server restoration). Still insufficient for calibration or accuracy claims. |
| Walk-forward history integrity | **Structural flaw — still open** | Only one fold exists; no `test`-segment rows exist; `walkForward.test.ts` wipes history on every run (Task #135, still open). |
| Segment specialists | **Not active — cannot be verified** | `specialist_models` table has 0 rows. No walk-forward run has populated it since the Task #151 holdout-validation fix landed. |
| Final-consistency invariant guard | **Working correctly** | Zero violations across 2,331 live rows (Task #162). |
| Player 1/2 orientation and winner display | **Working correctly** | Zero reversed winners, zero sub-50% on the labeled winner, zero predicted winners who aren't one of the two match players (Task #162 sweep). |

---

## 2. What the Audit Inspected and What It Didn't

### Inspected

- **5,092 `historical_test` rows** (4,120 graded, 972 void; all `validation` segment — no `test`-segment rows currently exist, see §9)
- **3,987 accuracy-eligible rows** (voided and retirement-excluded rows removed); overall accuracy **61.5%**
- **2,331 live `predictions` table rows** (paper-trading/manual), 2,311 graded
- **585 `paper_trade` rows** in `evaluation_predictions` (158 graded, 388 missed, 39 pending as of 2026-07-15)
- **0 `paper_trade_shadow` rows** — Shadow Replay has never been run in this environment
- Every module in `predictionEngine/` and the evaluation-side code
- All 11+ prior audit docs in `artifacts/api-server/docs/`
- Active calibration model: Platt method (ID 73, validation sample n=4,130, holdout log loss 0.6672 vs. isotonic 0.6687)

### Explicitly Not Inspected

- **No fresh walk-forward run** — would take 8–12+ minutes and wipes existing history (Task #135). All historical-backtest numbers reflect whichever run currently exists.
- **No Shadow Replay run** — stayed read-only; no shadow data exists to compare.
- **No per-model accuracy recomputation** — the ablation numbers in §5 come from two stored reports (Task #116's n=18,281 full-corpus run and Task #157's n=4,000 sampled run). Treat as directionally current, not as today's exact numbers.
- **No fresh calibration-error breakdown by band/tour/surface** — would require replaying the calibration curve, out of scope.

---

## 3. Data-Freshness Caveat (Read Before Using Any Number)

Every historical-backtest number in this report — and in every prior audit this report cites — comes from the `validation` segment of a single walk-forward fold. `walkForward.test.ts` unconditionally wipes and regenerates `evaluation_runs` and all `historical_test` rows every time it runs (tracked as Task #135, still open). This means:

1. Numbers are a snapshot of whichever run happened to exist at measurement time, not a stable ever-growing dataset.
2. There are **no genuinely held-out `test`-segment rows** — every accuracy/calibration claim rests entirely on validation-segment data, which the same model that generated it also used to fit calibration.
3. A future walk-forward run will silently replace all these numbers with a different snapshot.

This is not new — it has been the state since at least Task #116 — but it means every accuracy number here has wider uncertainty than its sample size alone implies.

---

## 4. Final Winner-Selection Logic

The decision path in order:

1. **Seven feature modules** compute a "player 1 edge" independently: Surface Elo, Serve & Return, Recent Form, Fatigue, Availability, Head-to-Head, Match Load Recovery.
2. **Three of those never vote** in the ensemble (Fatigue, Availability, Match Load Recovery) — they failed their own accuracy bar and are excluded by design from voting, though they still feed Data Quality.
3. **Four active modules vote**: Surface Elo, Serve & Return, Recent Form, and Head-to-Head (near-zero weight due to weak signal).
4. **Raw ensemble probability** is computed as a reliability-weighted average.
5. **Tie-break cascade fires** if the raw probability lands within 3 points of 50/50 — this is the confirmed bug (§6).
6. **Calibration** reshapes the probability using a fitted curve (currently Platt) or a Data-Quality-based fallback.
7. **A tour/surface segment specialist may blend in** if it has cleared its data-sufficiency threshold (currently: no specialists are active, `specialist_models` is empty).
8. **Monte Carlo simulator may blend in** at a per-match scope-scaled weight (currently inactive — simulator validation shows not adopted).
9. **Final-consistency guard** runs last and force-withholds Elite status if any of 12 invariants would be broken.

**Direct answers to common questions:**

| Question | Answer |
|---|---|
| Can calibration change which player is picked? | Yes in principle (could cross 50%); no evidence of it happening on real data. |
| Can a recommendation rule override the winner? | No — `recommendation.ts` labels an already-decided pick; it never feeds back into player selection. |
| Can Monte Carlo override the ensemble? | Yes, by design, when it has earned a validated weight. Currently weight=0 (not yet adopted). |
| Can weak modules (Fatigue, Availability, MLR) overturn core models? | No — they don't vote. |
| Can the tie-break cascade change the winner? | Yes — and per §6 it does so incorrectly on available evidence. |
| Can the displayed winner differ from the stored winner? | No paths found. `predictedWinnerProbability` was specifically built to prevent this class of bug. |

---

## 5. Model-by-Model Table

Numbers marked † come from the Task #116 full-corpus ablation (n=18,281 matches, run 2026-07-13). Numbers marked ‡ come from the Task #157 stratified-sample ablation (n=4,000, run 2026-07-15). Both are replay-based (not fresh out-of-sample), using the currently active calibration. Treat as directionally current.

| Module | Avg weight | Standalone accuracy | Removal impact (†/‡) | Miscalibration | Verdict |
|---|---|---|---|---|---|
| Surface Elo | 0.321 | 57.7% (†) | 0.0pt† / −0.6pt‡ | +1.5pt overconfident (†); −6.2pt underconfident (‡) | **Keep** — positive removal impact in larger sample; directionally useful, correlated with the other two below |
| Serve & Return | 0.280 | 58.2% (†) | +0.1pt† / +0.9pt‡ | +0.4pt overconfident (†); −0.5pt underconfident (‡) | **Review** — removal improves accuracy in both runs, especially the fresh stratified sample; may be adding noise in tight-signal regime |
| Recent Form | 0.381 | 56.0% (†) | +0.3pt† / +0.2pt‡ | +0.4pt overconfident (†); −6.4pt underconfident (‡) | **Review** — removal consistently improves slightly; opponent-adjusted delta shows real predictive separation (Task on recent-form trend validation) |
| Head-to-Head | 0.018 | 50.7% (†) | 0.0pt† / 0.0pt‡ | +0.6pt overconfident (†); +2.1pt overconfident (‡) | **Keep at near-zero weight** — already correctly down-weighted; do not raise without re-validating (open Task #155 covers this) |
| Fatigue | Excluded from vote | Not measured | +0.1pt† | Not measured | **Leave excluded** — investigate only if re-including is proposed; needs fresh leave-one-out on its own accuracy bar |
| Availability | Excluded from vote | Not measured | +0.1pt† | Not measured | **Leave excluded** — same as Fatigue |
| Match Load Recovery | Excluded from vote | Not measured | 0.0pt‡ | Not measured | **Leave excluded** — open task on re-checking accuracy as real results accumulate |
| Active Segment Specialist | Proportional blend | Not measured (0 rows active) | 0.0pt both runs (0 rows active) | +3.3pt overconfident when active (†) | **Cannot be verified** — `specialist_models` is empty; verify after next walk-forward run (Task #151 holdout fix unverified) |
| Monte Carlo simulator | Per-match, scope-scaled | Not measured against real outcomes | N/A (not adopted) | N/A | **Not yet validated** — weight=0; adoption requires simulator to beat ensemble log loss on enough graded rows |
| General Ensemble (blended) | 0.915 (dominant) | 58.2% (†) | +0.1pt† | +0.8pt overconfident (†) | **Baseline** — this is the blend itself, not an independent module |

**Key ablation findings:**

- The highest-impact single-module removal in the full-corpus run was **Recent Form (+0.3pt worse when present)**. In the sampled fresh run it was **Serve & Return (+0.9pt worse when present)**. Neither is a clean "remove it" signal — the two runs disagree in direction for Surface Elo and the effect sizes are small enough to be noise. Do not change weights based solely on these numbers.
- **Core signals only** (Surface Elo + Serve & Return + Recent Form, no other modules) produced 57.4% (†) and 61.6% (‡) — essentially matching the full engine, confirming that all additional modules add near-zero incremental value on these corpora.
- **Segment Specialist dissent accuracy** (when it *was* active in the Task #116 run): 56.6% on 417 dissents — the one module whose dissent from the ensemble was meaningfully correct more often than not. This is worth revisiting once specialists are active again.

---

## 6. Tie-Break Cascade — The Audit's Confirmed Bug

**What it does:** `tieBreakers.ts` fires whenever the raw ensemble probability is within 3 points of 50/50 (`TIE_BAND = 3`). It picks a direction from a 7-step priority list and nudges the probability by a fixed 2.5 points. Steps in priority order: Serve & Return → Surface Elo → Recent Form → surface win-rate history → ranking → Fatigue → Head-to-Head.

**How often it fires:** 1,509 of 3,987 graded validation rows — **38% of all predictions**.

**Measured accuracy by deciding step** (from Task #162's fresh query):

| Deciding step | n | Accuracy |
|---|---|---|
| Not applied (raw ensemble already clear) | 2,478 | **66.7%** |
| Applied — decided by Serve & Return | 1,374 | 53.7% |
| Applied — decided by Surface Elo | 120 | **46.7%** (worse than a coin flip) |
| Applied — decided by Recent Form | 7 | 42.9% |
| Applied — decided by Fatigue | 3 | 0.0% |
| Applied — decided by surface win-rate history | 1 | 100.0% (n=1, not meaningful) |

**Why this matters:** every step with a usable sample size performs 13–24 points below the non-applied baseline. Surface Elo's step is actively worse than random. Serve & Return decides 91% of all applied cases (n=1,374) and sits 13 points below the baseline. The problem is concentrated: this is overwhelmingly one signal (Serve & Return) failing in the specific "both players look equal" regime, not a spread-out failure across seven steps.

**What the system tells users:** when the tie-break fires, it displays a named justification ("Serve & Return gives a modest lean"). This reads as more trustworthy than an explicit coin flip while performing worse than one. This is the report's single confirmed bug, tracked as **Task #163**.

**Is it fixed?** No, as of 2026-07-15.

---

## 7. Probability Calibration

**Active calibration model:** Platt method (row ID 73), validation sample n=4,130 rows, fitted on the union of all fold validation-segment predictions. Holdout comparison: isotonic log loss 0.6687, Platt log loss 0.6672 — Platt won by 0.0015 log-loss points.

**Calibration by probability band** (from existing audit data — a fresh band-by-band ECE computation was out of scope):

| Band | Status | Source |
|---|---|---|
| 50–60% (bulk of all predictions) | Well-calibrated; slightly under-confident (observed accuracy ~60–64% vs. stated ~52–58%) | Task #116, confirmed directionally by fresh data |
| 60–67% | Well-calibrated | Task #116, Task #128 |
| 67–70% | Known weak spot, partially fixed by isotonic/Platt selection | Task #128 |
| 70%+ | Historically overconfident (stated 72%, observed closer to 60%); too few current rows to re-check | Task #116, Task #120 |
| 80%+ | No graded rows in current validation dataset | Fresh DB query |

**Key calibration facts:**
- The current corpus is **extremely tight**: 61% of rows within 5 points of 50/50; 94% within 10 points. The only band with a genuine calibration overclaiming problem (>70%) is essentially unreachable on today's data.
- **Does Shadow Replay use the calibration active on the historical date?** Task #160 implements this; its merge status was still in-progress as of the audit — should not be assumed done.
- **Does the general calibration need segment-specific curves?** The design already refuses per-segment calibration when the segment's sample is too thin (`MIN_VALIDATION_SAMPLES_FOR_SEGMENT=30`); no segment currently clears this bar (0 specialist rows).

---

## 8. Upset-Risk Tier Breakdown

**How tiers are computed** (`upsetRisk.ts`): a weighted score from six components — probability margin from 50% (up to 45 points, the dominant and cleanest signal), genuine core-model direction conflict (up to 25 points for real conflict, plus up to 8 from model-agreement alone), favorite weakness (up to 33 points), data-gap uncertainty (up to 15 points), thin surface-sample depth (up to 10 points), and tournament-level volatility (up to 7 points). A guardrail prevents EXTREME from being reached by one weak field alone.

**Actual rates on current graded validation data** (fresh DB query, n=3,987 accuracy-eligible rows):

| Tier | n | Favorite win rate | Upset rate | Avg calibrated prob |
|---|---|---|---|---|
| LOW | 333 | **75.4%** | 24.6% | 50.7% |
| MODERATE | 952 | 65.3% | 34.7% | 50.4% |
| HIGH | 1,128 | 63.3% | 36.7% | 50.5% |
| EXTREME | 1,574 | 55.0% | **45.0%** | 49.5% |

The expected ordering (EXTREME upset rate > HIGH > MODERATE > LOW) holds cleanly: 45.0% > 36.7% > 34.7% > 24.6%, with a wide spread. This is better-behaved than the non-monotonic pattern Task #116 found on an older dataset.

**By tournament level** (n ≥ 20):

| Level | EXTREME fav-win | HIGH fav-win | MODERATE fav-win | LOW fav-win |
|---|---|---|---|---|
| Challenger | 47.7% | 51.4% | 55.0% | 64.8% |
| GrandSlam | 56.2% | 68.1% | **52.6%** | 78.1% |
| ITF | 56.4% | 64.0% | 71.3% | 80.6% |

GrandSlam MODERATE (52.6%) sits below its own HIGH (68.1%) — a small local inversion at one level. Plausible noise at n=137 but worth monitoring.

**By surface** (n ≥ 20):

| Surface | EXTREME fav-win | HIGH fav-win | MODERATE fav-win | LOW fav-win |
|---|---|---|---|---|
| Clay | 53.8% | 62.0% | 64.0% | 67.7% |
| Grass | 56.2% | 63.2% | **56.5%** | 75.0% |
| Hard | 55.6% | 64.8% | 72.1% | 86.5% |

Grass shows the same MODERATE/HIGH near-tie as GrandSlam above — plausibly the same matches (the current corpus is heavily Wimbledon-era).

**Verdict:** upset-risk ordering is correctly monotonic on this dataset. The GrandSlam/Grass MODERATE/HIGH inversion is a suspected issue worth re-checking across multiple folds, not a confirmed bug.

---

## 9. Elite Prediction Findings

**Gate conditions** (`eliteTier.ts`): all three core signals agree on direction + calibrated margin ≥ 5 + Data Quality ≥ 55 + model agreement not HighDisagreement + upset risk not EXTREME.

**On the current validation dataset: zero predictions qualify as Elite.** The reason strings show the two most common blockers are "the three core signals don't all agree on direction" and "no validated segment specialist is backing this prediction."

**Root cause of zero Elite rows:** the margin-from-50% distribution is extremely tight. 2,422 of 3,987 rows (61%) are within 5 points of a coin flip; only 19 rows total (0.5%) are above a 15-point margin. The `margin ≥ 5` gate alone should pass ~40% of rows, but combined with "all three core signals agree" (which is structurally rare when the correlated trio isn't internally split) the joint condition apparently never co-occurs with the other three gates in this dataset.

**What this means:** Elite's historical evidence (from a different dataset snapshot, Task #116, where it showed a directionally positive but not statistically significant lift on n=267–468 rows) is the only evidence that currently exists about whether it works. On today's data it is simply unreachable.

**Verdict:** Insufficient evidence. Do not change the Elite gate. The confidence distribution compression is the real finding — investigate whether it persists across multiple time windows once Task #135 is fixed.

---

## 10. Strong Recommendation Findings

**Gate conditions** (`recommendation.ts`): `margin ≥ 22` (confidence ≥ 72%) + Data Quality ≥ 45 + upset risk LOW or MODERATE + model agreement not Mixed/HighDisagreement.

**On the current validation dataset: zero rows reach STRONG_RECOMMENDATION.** The maximum observed margin in this corpus is 20.6 (one row), so the `margin ≥ 22` gate never fires. Zero rows reach DO_NOT_RECOMMEND either (minimum DQ is 31, never below the <25 floor).

**Reconstructed recommendation tiers** (retroactive reconstruction from stored fields, same method as Task #116, on 3,987 accuracy-eligible rows):

| Reconstructed tier | n | Accuracy | Avg probability |
|---|---|---|---|
| MODERATE_LEAN | ~466 | ~75.8% | ~50.7% |
| HIGH_RISK | ~2,025 | ~63.6% | ~50.4% |
| NO_STRONG_SIGNAL | ~1,496 | ~54.3% | ~49.5% |
| STRONG_RECOMMENDATION | **0** | — | — |
| DO_NOT_RECOMMEND | **0** | — | — |

*(Numbers from Task #162's fresh query, used as the best available source; fresh reconstruction using exact current-engine margin thresholds not re-run.)*

**Prior finding (still the only evidence available):** Task #116 (n=189) and Task #120's independent fold (n=44) both found STRONG_RECOMMENDATION had the worst log loss of any tier (0.736 and 0.729 respectively, both worse than the 0.693 coin-flip baseline). Task #120 traced this to the **calibration curve itself** being overconfident above ~70%, not to the specific gate thresholds. This conclusion has not been overturned by anything in Task #162 — it simply cannot be re-confirmed on current data because there's nothing to check.

**What not to do:** do not re-tune the `margin ≥ 22` threshold. Task #120 confirmed the problem is in the calibration curve, not these gates.

---

## 11. Shadow Replay vs. Walk-Forward vs. Real Paper Trading

| | Walk-forward backtest | Shadow Paper Trading | Real paper trading |
|---|---|---|---|
| Prediction count | 5,092 (`historical_test`, all `validation` segment) | **0** | 585 in `evaluation_predictions` (`paper_trade`) |
| Graded | 3,987 (accuracy-eligible) | 0 | **158** |
| Accuracy | 61.5% overall | N/A | Not statistically usable |
| Date range | Mostly Wimbledon-2026-era window | N/A — no batches exist | 388 of 585 rows are `status='missed'`, 39 `pending` |
| Calibration path | Currently active Platt curve | Should use curve active on historical replay date (Task #160, merge status unverified) | Today's live Platt curve |
| Feature path | Confirmed identical to live engine | Same, by design | The actual live path |
| Known limitations | One fold; no test-segment rows; history wiped by test suite (Task #135) | **No data has ever been run in this environment** | 158 graded rows — insufficient for calibration measurement, though growing |

**Meaningful comparison:** cannot be made between any two of these three paths. Walk-forward vs. Shadow Replay: impossible, Shadow Replay has zero rows. Walk-forward vs. real paper trading: 158 graded rows is growing but still too small for reliable accuracy/calibration comparisons. **This is the same blind spot Task #116 first flagged, and it persists** (though paper-trade graded volume has grown from 5 to 158 since the original audit, partly from the API server restoration on 2026-07-15).

---

## 12. Top 15 Most Confident Wrong Predictions

All from graded validation set, sorted by predicted winner confidence (highest first). The corpus's confidence distribution is tight — top confidence wrong prediction is 67.1%.

| Match | Level | Surface | Predicted winner | Actual winner | Confidence | Agreement | Risk |
|---|---|---|---|---|---|---|---|
| Chan H-/Krejcikova vs. Errani/Paolini | GrandSlam | Grass | Errani/Paolini | Chan H-/Krejcikova | 66.3% | Strong | MODERATE |
| J-L. Struff vs. F. Misolic | GrandSlam | Grass | F. Misolic | J-L. Struff | 67.1%* | Strong | LOW |
| Pavlasek/Zielinski vs. Gonzalez/Krajicek | GrandSlam | Grass | Gonzalez/Krajicek | Pavlasek/Zielinski | 64.6%* | Strong | MODERATE |
| E. Svitolina vs. B. Haddad Maia | WTA250 | Grass | E. Svitolina | B. Haddad Maia | 65.6% | Strong | LOW |
| Machac/Mensik vs. Martinez/Munar | GrandSlam | Grass | Machac/Mensik | Martinez/Munar | 65.1% | Mixed | MODERATE |
| F. Auger-Aliassime vs. J-L. Struff | GrandSlam | Grass | F. Auger-Aliassime | J-L. Struff | 64.3% | Strong | LOW |
| A. Barrena vs. R. Carballes Baena | Challenger | Clay | A. Barrena | R. Carballes Baena | 64.1% | Strong | LOW |
| A. Rinderknech vs. A. Zverev | GrandSlam | Grass | A. Zverev | A. Rinderknech | 63.1%* | Strong | LOW |
| Kusuhara/Nakagawa vs. Katayama/Kono | ITF | Hard | Kusuhara/Nakagawa | Katayama/Kono | 63.4% | Moderate | LOW |
| V. H. Remondy Pagotto vs. Pa. Tsitsipas | ITF | Clay | V. H. Remondy Pagotto | Pa. Tsitsipas | 62.5% | **HighDisagreement** | **EXTREME** |
| M. Topo vs. L. Preda | Challenger | Clay | M. Topo | L. Preda | 62.5% | Strong | LOW |
| C. Doig vs. L. Miguel | GrandSlam | Grass | C. Doig | L. Miguel | 62.7% | Strong | MODERATE |
| P. Martinez vs. A. Santamarta Roig | Exhibition | Grass | A. Santamarta Roig | P. Martinez | 62.6%* | Strong | LOW |
| B. Krejcikova vs. A. Eala | GrandSlam | Grass | A. Eala | B. Krejcikova | 62.6%* | Strong | LOW |
| Bouzige/Ilagan vs. Maginley/Perez | Challenger | Hard | Maginley/Perez | Bouzige/Ilagan | 63.2%* | Strong | MODERATE |

*These rows: the probability column stores the player-1-relative calibrated probability; the displayed winner probability is the mirrored value.

**Root-cause grouping:** 13 of 15 are `Strong` agreement and `LOW`/`MODERATE` risk — the system was genuinely calm and confident about these and was still wrong. This is the expected cost of a well-calibrated 62–67% system: it *should* lose about 33–38% of the time in this band. Only 1 of the 15 (the ITF Clay row) was already correctly flagged as HighDisagreement/EXTREME before losing. **No single systemic root cause clusters across these losses** — this looks like ordinary calibrated variance, not a hidden bug.

---

## 13. Confirmed Bugs

### Bug #1: Tie-break cascade underperforms coin flip (ACTIVE, unresolved)

- **Severity:** High
- **Files:** `predictionEngine/tieBreakers.ts`, called from `predictionEngine/index.ts`
- **Affected predictions:** 1,509 of 3,987 graded validation rows (38%)
- **Effect:** turns an honest 50/50 into a directional lean that, on real evidence, is wrong more often than the coin flip it replaced. Adds a named justification ("Serve & Return gives a modest lean") that reads as trustworthy while performing worse than random for the Surface Elo step.
- **Tracked as:** Task #163
- **Not yet fixed**

### Previously confirmed bugs — already fixed (kept for completeness)

| Bug | Fixed in | Status |
|---|---|---|
| Correlated-cluster double-counting (Surface Elo / Serve & Return / Recent Form voting as three independent confirmations when they agreed) | Task #146 (`collapseCorrelatedCluster`) | Fixed, verified on current data |
| 65–70% confidence-band Platt-vs-isotonic selection blind spot causing local overconfidence | Task #128 | Fixed |
| Data Quality blend silently dropping three of its seven documented modules | Task #111 | Fixed; DQ direction inversion confirmed corrected |
| DQ-threshold calibration reversal above ~55 | Task #75 | Fixed |
| Winner/loser set-score display bug | Pre-existing fix in `index.ts`, confirmed in code comments | Fixed |
| High-DQ predictions being *less* accurate than low-DQ ones (direction inverted) | Task #111 + Task #157 verification | Fixed (high-DQ now 62.5% vs. low-DQ 60.1%) |
| Specialist segment overconfidence due to in-sample calibration fitting | Task #151 (holdout-validated `fitBestCalibration`) | Code fix live; cannot be verified until `specialist_models` is repopulated |

---

## 14. Suspected Issues (Not Yet Confirmed as Bugs)

### Suspected #1: Zero rows currently reach Strong Recommendation or Elite tier

**Why suspicious:** both are the system's flagship "trust this one" labels, and neither can currently fire on any validation row. The confidence distribution has 0.5% of rows above a 15-point margin.

**Missing evidence:** whether this is a property of this specific Wimbledon-era dataset window (genuinely close matches) or a broader symptom of the calibration curve compressing everything toward 50–60%.

**Test that would confirm or reject it:** compare the margin distribution across several independent walk-forward folds/windows once Task #135 stops wiping history. If every window shows this compression, it points at the calibration curve; if it's specific to this window, it's just this match slate.

**Do not act on this yet:** the gate thresholds themselves are not the problem (Task #120 confirmed that). Investigate the confidence distribution first.

### Suspected #2: Grand Slam MODERATE/HIGH upset-rate near-tie (§8)

**Why suspicious:** GrandSlam MODERATE 52.6% vs. HIGH 68.1% is a local break in monotonicity at a single level/tier combination.

**Missing evidence:** n=137 in the affected cell; could easily be noise. Also possibly confounded by this corpus being heavily Wimbledon-era.

**Test:** re-check the same level/surface cells across multiple independent folds/windows.

---

## 15. What Is Already Working — Do Not Re-Audit

| Feature | Evidence |
|---|---|
| Leakage-safe historical cutoff | `historicalScoring.ts` confirmed to call the same `runPredictionEngine()` as live path, with documented exclusions (Task #162) |
| Immutable prediction ledger | DB trigger enforces settle-once on `evaluation_predictions`; `calibratedProbability` and `foldId` are the only documented exemptions |
| Correct player orientation and winner display | Zero reversed winners, zero sub-50% on labeled winner, zero mismatched players across 2,331 live rows (Task #162 sweep) |
| Correlated-cluster collapse | Measurably improved calibration; HighDisagreement accuracy gap (54.2% vs. 65–72%) confirmed on current data |
| Model-agreement categorization | HighDisagreement correctly predicts lower accuracy; Mixed/Moderate/Strong correctly ordered (§4 of this report) |
| Upset-risk tier ordering | Correctly monotonic on current dataset (§8 of this report); an improvement in kind over Task #116's non-monotonic result |
| Final-consistency invariant guard | Zero violations across 2,331 live rows |
| Data Quality direction fix (high-DQ predicts better than low-DQ) | Confirmed in Task #157 fresh ablation: high-DQ 62.5% vs. low-DQ 60.1% |

---

## 16. Strict Priority Order for Next Work

### Priority 1 — Fix the tie-break cascade (Task #163)

**Why first:** 38% of predictions go through a mechanism that is actively worse than a coin flip. This is the largest, best-evidenced, previously-unmeasured accuracy problem currently active in the system.

- **Evidence:** 1,374 Serve & Return-decided rows at 53.7%; 120 Surface Elo-decided rows at 46.7%; non-applied baseline 66.7%.
- **Expected impact:** if tie-break-decided predictions can be brought to baseline accuracy, overall accuracy could improve by several points on the affected 38%.
- **Files:** `predictionEngine/tieBreakers.ts`, `predictionEngine/index.ts`
- **Recommended approach:** root-cause *why* each step fails in the close-to-50/50 regime before re-ordering or replacing steps. A conservative minimum fix (report 50/50 honestly when uncertain rather than a named wrong lean) cannot make things worse than status quo.
- **Required validation:** re-measure tie-break-applied accuracy against the same graded cohort used here; add a regression guard so this cannot silently regress.
- **Acceptance metric:** tie-break-decided accuracy statistically indistinguishable from (or better than) the non-applied 66.7% baseline.

### Priority 2 — Stop walk-forward from wiping evaluation history (Task #135)

**Why second:** every future measurement — including verifying the tie-break fix — depends on having stable, accumulating evaluation history that test runs don't destroy. Right now there is no genuinely held-out test fold, which means no honest before/after comparison can be made for any future fix.

- **Expected impact:** unblocks trustworthy measurement of every improvement, including Priority 1.
- **Risk:** low — this is a data-preservation fix, not a scoring-logic change.
- **Acceptance metric:** `evaluation_runs` retains multiple folds and a genuine `test` segment after the test suite runs.

### Priority 3 — Land Tasks #129 + #130 (real paper-trading schedule + quiet-pipeline alert)

**Why third:** 158 graded paper-trade rows exist as of today (up from 5, but still too few for calibration or accuracy claims). Until live graded volume grows past the hundreds, no live-only claim about any fix can be verified against real forward performance — only against backtest.

- **Expected impact:** unblocks live-performance measurement for all future fixes; surfaces a stalled pipeline before days or weeks of silent gaps accumulate.
- **Acceptance metric:** graded paper-trade volume grows steadily week over week.

---

## 17. What Not to Change (Yet)

| What | Why not |
|---|---|
| STRONG_RECOMMENDATION / Elite tier thresholds | Task #120 confirmed the problem lives in the calibration curve above ~70%, not these gates. Re-tuning gates without fixing the calibration curve just re-fits noise. And both tiers are currently unreachable, so there's nothing to tune against. |
| Head-to-Head's weight | Already an open, correctly-scoped question (Task #155). This audit's evidence doesn't add new weight either way. |
| Splitting winner / risk / recommendation / Elite into separate systems | These are already independent pure functions internally. `finalConsistencyCheck.ts` deliberately cross-checks all three together to catch contradictions (e.g. "Elite" + "Extreme risk" + "no model conflict" claimed simultaneously). Splitting would remove the only mechanism that currently guarantees they agree. |
| Any module weights, calibration knots, or DQ thresholds | No fresh walk-forward evidence justifies a change right now (no test-segment fold exists; ablation samples are too small and confounded by corpus growth). |

---

## 18. What This Report Does Not Prove

- **Shadow Replay behavior:** no batches have ever been run. §11's shadow-replay "findings" are "no data exists," not "looks fine."
- **Calibration error by band/tour/surface:** not freshly computed. Stated calibration assessments reuse prior audit snapshots.
- **Per-model accuracy numbers (§5):** reused from Task #116 and Task #157 ablation snapshots, not recomputed against today's exact validation rows.
- **Specialist segment performance:** cannot be measured; `specialist_models` is empty.
- **Strong Recommendation and Elite performance:** not measurable on current data; tiers are unreachable given the tight confidence distribution.
- **Cross-window/cross-season stability:** all numbers come from one dataset snapshot (mostly a Wimbledon-era window). Whether findings hold on a different time window is unknown.
- **Absence of a detected bug is not proof no bug exists:** the hidden-bug sweep checks a specific enumerated list of failure modes; it cannot rule out failure modes not yet thought to check for.

---

## 19. Appendix: Calibration Model Details

Active model as of 2026-07-15:

| Field | Value |
|---|---|
| Method | Platt (beats isotonic by 0.0015 log-loss on holdout) |
| Validation sample size | 4,130 rows |
| Isotonic holdout log loss | 0.6687 |
| Platt holdout log loss | 0.6672 |
| Holdout sample size | 826 rows |
| Active | Yes (row ID 73) |

Two superseded copies also exist (IDs 71, 72, identical parameters) — these are the prior-history artifact rows that form the calibration timeline; they are correctly marked `active = false` and not used for live predictions.
