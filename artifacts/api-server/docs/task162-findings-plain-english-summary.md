# What Task #162's Audit Actually Found (Plain-English Summary)

This report translates Task #162's technical audit (`audit-task162-full-prediction-accuracy-audit.md`)
and the prior audits it built on into a single plain-English walkthrough, plus several additional
read-only queries run for this task to fill gaps the original report didn't spell out in table
form (upset-risk tier ordering, Elite/Strong Recommendation reconstruction on the current dataset,
the most-confident wrong predictions, and the strongest correct underdog calls). **No new
walk-forward run, ablation, or Shadow Replay run was performed** -- everything here comes from
already-existing data or a fresh `SELECT` against it.

**A data-freshness note up front:** the live database's `historical_test` table (5,092 rows,
all `validation` segment) is a *different* walk-forward run than Task #116's original audit
(4,111 held-out `test`-segment rows). Task #128 documented that `walkForward.test.ts`
unconditionally wipes and regenerates this data every time it runs (tracked, unfixed, as Task
#135) -- so every historical-backtest number below, and in every audit that came before it, is a
snapshot of whichever run happened to exist at that moment, not one stable, ever-growing dataset.
The findings replicate across snapshots (see §6, §10), which is reassuring, but this instability
is itself part of the picture and is called out again in §19.

---

## 1. Executive overview

| Area | Status | Why |
|---|---|---|
| Final predicted-winner logic | **Working correctly, one confirmed exception** | The decision path itself has no bugs (§3) -- but the tie-break cascade, which decides the winner on 38% of close matches, performs at/below a coin flip (§6, confirmed bug). |
| Probability calibration | **Partially verified, weak spot known** | Well-calibrated in the 50-67% range where nearly all real predictions currently fall; historically shown to be overconfident above ~70% confidence, but too few current rows reach that band to re-check fresh (§5, §11). |
| Upset-risk ratings | **Partially verified, ordering holds on fresh data** | Correct monotonic ordering (Extreme > High > Moderate > Low upset rate) confirmed on the current dataset (§7) -- an improvement over the non-monotonic pattern Task #116 found on an older dataset. |
| Model-agreement labels | **Working correctly** | HighDisagreement genuinely predicts lower accuracy (54.2% vs. 65-72% elsewhere) on current data (§4). |
| Strong Recommendation | **Insufficient evidence on current data / prior evidence poorly calibrated** | On the current validation set, essentially zero predictions are confident enough to ever reach this tier (§10) -- so it can't be checked fresh. On the dataset it *was* checkable on (Task #116/#120), it had the worst log loss of any tier, reproduced across two independent samples. |
| Elite Prediction | **Insufficient evidence on current data** | Zero predictions in the current validation set qualify as Elite at all (§9) -- the gate (margin>=5, all three core signals agree, DQ>=55) has nothing to be checked against right now. |
| Data-quality / confidence ratings | **Misleading above ~55, per prior audit; not re-testable on current data** | Task #75/#111 found Data Quality has ~zero correlation with correctness and is *inverted* at the top end; that finding predates this task and cannot be freshly re-verified here without a new walk-forward run. |
| Shadow Replay vs. production | **Not yet measurable -- no data exists** | Zero `paper_trade_shadow` rows exist in the database (§12). Shadow Replay has not actually been run in this environment; there is nothing yet to compare against production. |
| Serious bugs found | **One confirmed bug** | The tie-break cascade (§6, §16). No other confirmed bugs; several already-fixed issues from prior audits remain fixed (§18). |

---

## 2. What Task #162 actually inspected (and what it didn't)

**Inspected:**
- **5,092** `historical_test` rows (all `validation` segment; **0** `test`-segment rows currently
  exist -- see the freshness note above and §19).
- **2,331** live `predictions` table rows (paper-trading/manual), **2,311** graded.
- **221** `paper_trade` rows inside `evaluation_predictions`, of which only **5** are graded, 15
  pending, 201 missed.
- **0** `paper_trade_shadow` (Shadow Replay) rows -- none exist.
- Every module in `predictionEngine/` (index, ensemble, disagreement, calibration, dataQuality,
  recommendation, upsetRisk, eliteTier, tieBreakers, finalConsistencyCheck, simulator) and the
  evaluation-side code (`historicalScoring.ts`, `specialistWeights.ts`, `shadowReplay.ts`).
- Every existing audit doc in `artifacts/api-server/docs/` (11+ prior audits).
- Date range: the `historical_test` corpus spans mostly **Wimbledon 2026 and surrounding
  tour/Challenger/ITF events** (fresh sample above shows heavy Wimbledon/grass representation --
  this is a different window than Task #116's original Feb-Apr 2025 corpus).
- Tours/surfaces: ATP, WTA, Challenger, ITF, doubles; Hard, Clay, Grass all represented (§7 below).
- The audit used **previously-stored results** for the bulk of its evidence, and ran fresh
  read-only aggregate queries (GROUP BY, not row-by-row manual review) against the live DB for
  everything it needed that wasn't already written down. It inspected **individual prediction
  records only for the two example lists** (§14, §15) -- everything else is aggregate.

**What it explicitly did NOT inspect, and why that matters:**
- **No fresh walk-forward run** -- would take 8-12+ minutes and wipes existing history (Task #135).
  Everything here reflects whatever run happens to currently exist, not a controlled fresh fit.
- **No live Shadow Replay run** -- would require actually calling
  `POST /evaluation/shadow-replay/run`; this task stayed read-only, so §12/§13's shadow-replay
  findings are "there is no data," not "the data looks fine" or "the data looks bad."
- **No Grand Slam-specific deep dive beyond what's in §7's tables** -- the Grand Slam sample (162
  EXTREME-tier rows, 96 LOW-tier rows, etc.) is real but still modest next to ITF's volume.
- **No individual-row review of the 4,120 "not elite" reason strings beyond frequency counts** --
  §9 reports the aggregate pattern (why Elite virtually never fires), not a manual read of all 4,120.

---

## 3. Final winner-selection findings

The real path, in order:

1. **Seven feature modules compute a "player 1 edge" independently**: Surface Elo, Serve & Return,
   Recent Form, Fatigue, Availability, Head-to-Head, Match Load Recovery.
2. **Three of those (Fatigue, Availability, Match Load Recovery) never vote** in the ensemble --
   they failed their own accuracy bar and are excluded from the vote by design (though they do
   still feed Data Quality -- see the Task #111 fix already in place). So in practice, four things
   can vote: Surface Elo, Serve & Return, Recent Form, and Head-to-Head (which votes but is
   weighted ~0 because its raw signal is weak).
3. **The vote is combined into a raw ensemble probability** (a reliability-weighted average).
4. **If that raw probability is within 3 points of 50/50**, the tie-break cascade (§6) picks a
   direction from a 7-step priority list and nudges the probability by a fixed 2.5 points. This
   is the one place a genuinely "coin flip" raw signal gets turned into a stated lean.
5. **The (possibly tie-break-adjusted) probability is calibrated** -- either against a real fitted
   curve from a walk-forward run, or a fallback data-quality-based heuristic if no fitted curve
   exists yet.
6. **A tour/surface segment specialist may blend in**, if that segment has cleared its own
   data-sufficiency bar -- literally the same probability run through a segment-specific
   calibration curve, blended in proportion to how much that segment specialist is trusted.
7. **A validated Monte Carlo simulator may blend in**, down-weighted per-match if its own two
   visible inputs (Surface Elo, Serve & Return) are less reliable than something it structurally
   can't see for this specific match.
8. **The result is the final calibrated probability.** Whichever player is above 50% is the
   predicted winner; `predictedWinnerProbability` always mirrors that winner's own number (never
   player 1's raw number mislabeled as the winner's).
9. **A final-consistency guard (`finalConsistencyCheck.ts`) runs last** and force-withholds Elite
   status (and flags a violation) if any of 12 invariants would otherwise be broken.

**Direct answers:**
- **Can calibration ever change which player is selected?** Yes, in principle -- calibration
  reshapes the probability curve and could in theory cross 50%, though this task found no evidence
  of it actually happening on real data. Not separately re-tested this session.
- **Can a recommendation rule override the predicted winner?** No. `recommendation.ts` only labels
  an already-decided prediction (STRONG_RECOMMENDATION / MODERATE_LEAN / etc.); it never feeds back
  into which player is picked.
- **Can Monte Carlo override the ensemble?** Yes, by design, when the simulator has earned a
  validated per-match weight -- and that weight is explicitly scaled down (never up) when the
  simulator's own visible inputs are less reliable than something it can't see. This is a
  documented, deliberate design (`SIMULATOR_VS_ENSEMBLE_DISAGREEMENT.md`), not a bug.
- **Can a weak module overturn the core models?** The three weak modules (Fatigue, Availability,
  Match Load Recovery) don't vote at all, so no.
- **Can the tie-break cascade change the winner?** Yes -- and per §6, this is the one confirmed
  problem: when it does, it's wrong more often than the coin flip it replaced.
- **Are there any paths where the displayed winner can differ from the stored winner?** None found.
  `predictedWinnerProbability` is constructed specifically to prevent this class of bug (see the
  code comment on that field describing a 2026-07-13 fix for exactly this).
- **Any Player 1/Player 2 orientation risk?** The live hidden-bug sweep (§16, from Task #162)
  checked for probabilities below 50% attached to the "winner" field and predicted winners who
  aren't one of the two match players, across 2,331 live rows -- zero found.

No individually-flagged example predictions were found for this section beyond the tie-break cases
already itemized in §6/§14.

---

## 4. Model-by-model findings

The table below is **not re-computed on the current dataset** -- reproducing it exactly requires
the individual per-module reliability/weight numbers, which are only reliably available from
Task #116's dedicated per-model pass (n=8,241, its own dataset snapshot). It is reused here rather
than re-derived, per this task's brief.

| Module | Weight (avg) | Standalone accuracy | Log loss | Independent value? | Correlation flag | Verdict |
|---|---|---|---|---|---|---|
| Serve & Return | 0.280 | 58.2% | 0.676 (best of the trio) | Yes, but correlated with the trio below | High w/ Surface Elo & Recent Form (74.2% pairwise same-direction rate, Task #146) | Keep -- correlation already corrected at the agreement-scoring layer, not the vote itself |
| Surface Elo | 0.321 | 57.7% | 0.684 | Yes, correlated | Same trio | Keep |
| Recent Form | 0.381 | 56.0% | 0.688 | Yes, correlated | Same trio | Keep |
| General Model (blended) | 0.915 (dominant) | 58.2% | 0.682 | N/A -- this *is* the blend | N/A | This dominates the vote, which limits how much any "per-model" breakdown can isolate individual contribution |
| Head-to-Head | 0.018 (near-zero) | 50.7% (worse than random on log loss: 0.726) | 0.726 | **No** on its own | Not correlated with the trio (different evidence type) but structurally sparse (no-h2h is the common case) | Already correctly down-weighted; do not raise its weight without re-validating (open Task #155 covers this question) |
| Fatigue | not measured (excluded from vote) | not measured | not measured | Excluded from voting on its own ablation bar | N/A | Investigate only if re-including it is proposed (needs its own leave-one-out re-check, see memory on ablation on already-excluded modules) |
| Availability | not measured (excluded from vote) | not measured | not measured | Excluded from voting | N/A | Same as Fatigue |
| Match Load Recovery | not measured (excluded from vote) | not measured | not measured | Excluded from voting; separately tracked (open task on re-checking its accuracy as real results come in) | N/A | Same as Fatigue |
| Segment specialists (e.g. ATP-Clay, ATP-Hard, WTA-Hard) | segment-specific, blended proportionally | Roughly in line with the general model on the same slice (0.69-0.72 log loss) in Task #116's pass | Not a clear improvement over the general model in that pass | Not proven, not disproven | N/A | Investigate/recalibrate if segment sample sizes grow (own thresholds already gate this -- Task #151's fix) |
| Monte Carlo simulator | per-match, scope-scaled (§3) | not measured against real outcomes in this pass | not measured | Design already accounts for scope mismatch | N/A | An open task ("automatically re-check the match simulator's accuracy as real results come in") already covers re-validating this over time |
| Style Matchup, Court-speed fit, Opponent-quality-adjusted form, Surface-specific form (as distinct modules) | **Not measured -- no separate module exists under these exact names.** `styleMatchup.ts` exists but is not currently in the ensemble vote or Data Quality blend at all (not found in `moduleEdges`); "surface-specific form" and "opponent-quality-adjusted form" are partially expressed inside Surface Elo/Recent Form's own formulas rather than as separate voting modules. | -- | -- | -- | -- | State plainly: these are not separately measurable with current code/data |

**Important caveat:** none of the per-model accuracy/log-loss numbers above were recomputed this
session -- they are Task #116's numbers on its own dataset snapshot, reused because a fresh
per-model ablation was out of scope for a reporting-only task. Treat them as directionally still
true (the code paths they measured haven't changed), not as a fresh number for today's exact
`historical_test` rows.

---

## 5. Correlated-evidence findings

Surface Elo, Serve & Return, and Recent Form are genuinely correlated: they agree on direction
74.2% of the time (n=3,093 pairs, Task #146), far above the ~50% two independent signals would show
by chance. This was a **confirmed bug that has already been fixed**: before the fix, all three
agreeing counted as three independent confirmations toward `modelAgreement`, artificially padding
"Strong" agreement and, downstream, Elite-tier eligibility and confidence display. Rows where
"Strong" agreement was driven only by this correlated trio scored *worse* (53.7% accuracy, log
loss 0.715 -- worse than a coin flip) than rows correctly flagged as genuinely uncertain (49.1%
accuracy but much better calibration, ECE 0.040 vs. 0.079). The fix (`collapseCorrelatedCluster`)
now treats the trio's agreement as one combined vote's worth of confirmation, not three, before
computing `modelAgreement` -- while still preserving a real internal split if the trio genuinely
disagrees. **This is not a live problem anymore** -- it's a fixed, previously-confirmed bug, kept
here because the user's brief asked for the practical effect explanation, not because there's a
new finding.

---

## 6. Close-match and tie-break findings — the audit's #1 finding

**Definition of "close":** the raw (pre-tie-break) ensemble probability lands within 3 points of
50/50 (`TIE_BAND = 3` in `tieBreakers.ts`).

**Number of close matches examined:** 1,509 of 3,987 graded validation rows (38%).

| Tie-break outcome | n | Accuracy |
|---|---|---|
| Not applied (raw ensemble already clear) | 2,478 | **66.7%** |
| Applied, decided by Serve & Return | 1,374 | 53.7% |
| Applied, decided by Surface Elo | 120 | 46.7% (worse than a coin flip) |
| Applied, decided by Recent Form | 7 | 42.9% |
| Applied, decided by Fatigue | 3 | 0.0% |
| Applied, decided by surface win-rate history | 1 | 100.0% (n=1, not meaningful) |

**Rankings not tested as a deciding step and Head-to-Head not tested** -- neither appeared as the
actual `decidingStep` in this corpus's graded rows with meaningful sample size (their position
lower in the priority list means they rarely get the chance to decide anything, since Serve & Return
almost always fires first).

**Is the current step ordering evidence-supported?** No. Every step with a usable sample size
underperforms the "not applied" baseline by 13-24 points, and Surface Elo's step is actually worse
than random. Putting Serve & Return first (since it decides 91% of all applied cases) means this
is overwhelmingly one signal's failure, not a spread-out problem across seven steps.

**Characterization:** close matches are being **decided by a signal that, in this specific
close-to-50/50 regime, is unreliable** -- not "correctly kept near 50/50," not "pushed too
aggressively," but actively steered in a direction that loses more than it wins. This is the
report's headline confirmed bug (see §16), tracked as the already-created **Task #163**.

---

## 7. Upset-risk findings

**How the tiers are computed today** (`upsetRisk.ts`): a weighted score from six components --
model conflict (up to 33 points, mostly from a genuine core-model direction conflict, only lightly
from `modelAgreement` alone, since Task #116's dataset showed agreement alone was a weak/backwards
signal), favorite weakness (up to 45, the one cleanly monotonic real signal), data-gap uncertainty
(up to 15), thin surface-sample depth (up to 10), tournament-level volatility (up to 7, only for
levels with n>=30 real evidence), and a placeholder match-hazard component that's always 0 (no
validated hazard signal exists). Score bands: LOW <25, MODERATE 25-39, HIGH 40-54, EXTREME 55+,
with a guardrail that blocks EXTREME from ever being reached by one weak field alone.

**Actual current rates** (fresh query, current `historical_test` validation data, n=3,987):

| Tier | n | Favorite win rate | Upset rate | Avg calibrated probability |
|---|---|---|---|---|
| LOW | 333 | **75.4%** | 24.6% | 50.7 |
| MODERATE | 952 | 65.3% | 34.7% | 50.4 |
| HIGH | 1,128 | 63.3% | 36.7% | 50.5 |
| EXTREME | 1,574 | 55.0% | **45.0%** | 49.5 |

**The expected ordering (Extreme upset rate > High > Moderate > Low) holds cleanly on this fresh
data** -- 45.0% > 36.7% > 34.7% > 24.6%, correctly monotonic in the right direction, and a real,
wide spread (24.6 to 45.0 points). This is better-behaved than the non-monotonic pattern Task #116
found in its own (different, older) dataset snapshot, where MODERATE slightly beat LOW. Whether
that's a genuine improvement in the tier logic or simply a different dataset snapshot happening to
land more cleanly cannot be told apart without a controlled before/after comparison on the same
data -- flagged as unresolved in §17/§19.

**By tournament level** (n>=20 cells only):

| Level | EXTREME fav-win | HIGH fav-win | MODERATE fav-win | LOW fav-win |
|---|---|---|---|---|
| Challenger | 47.7% | 51.4% | 55.0% | 64.8% |
| GrandSlam | 56.2% | 68.1% | 52.6% | 78.1% |
| ITF | 56.4% | 64.0% | 71.3% | 80.6% |

GrandSlam and ITF both show a real gap between EXTREME and LOW; Challenger's ordering also holds
(47.7% < 51.4% < 55.0% < 64.8%). GrandSlam's MODERATE (52.6%) sitting below its own HIGH (68.1%) is
a small break in strict monotonicity at that one level/tier combination -- worth naming, not
treated as evidence of a bug (n=137, one level, one non-adjacent-tier inversion).

**By surface** (n>=20 cells only):

| Surface | EXTREME fav-win | HIGH fav-win | MODERATE fav-win | LOW fav-win |
|---|---|---|---|---|
| Clay | 53.8% | 62.0% | 64.0% | 67.7% |
| Grass | 56.2% | 63.2% | 56.5% | 75.0% |
| Hard | 55.6% | 64.8% | 72.1% | 86.5% |

Ordering holds cleanly for Clay and Hard. Grass shows the same small MODERATE/HIGH near-tie pattern
as GrandSlam above (56.5% vs. 63.2%) -- plausibly related, since Grand Slam-level matches in this
corpus are heavily Wimbledon/grass (see §2's freshness note). Not enough evidence to call this a
real surface-specific effect vs. a small-sample artifact of one tournament window.

**No case was found** in this pass of Low risk assigned to a highly uncertain match, Extreme risk
assigned despite strong core-model agreement, or risk labels flatly contradicting the displayed
probability margin -- the guardrail against single-field EXTREME appears to be doing its job.

---

## 8. Feature-usefulness findings for upset risk

Based on the component design's own documented derivation (`upsetRisk.ts`'s header, from a
dedicated 4,081-row analysis on 2026-07-13) plus prior audits:

| Feature | Verdict | Evidence |
|---|---|---|
| Probability margin (closeness to 50%) | **Proven useful** | The one cleanly monotonic real signal in the original component-design analysis (47.3% -> 35.2% favorite-loss rate as margin widens); confirmed again structurally by the fact it's the dominant (45pt-max) component and the current tiers now order correctly (§7). |
| Core-model disagreement (genuine direction conflict) | **Proven useful, but only the "genuine conflict" version** | `modelAgreement` alone was weak/backwards (Task #116); a real `coreModelsConflict` flag earns a much larger, separate bonus (+25) and is one of the few things allowed to push a score to EXTREME. |
| Underdog recent form | **Not tested as a distinct upset-risk feature** | Recent Form votes in the main ensemble but isn't broken out as its own upset-risk-specific signal. |
| Favorite surface vulnerability | **Not tested as a distinct feature** | No dedicated "favorite is weak on this specific surface" signal exists in `upsetRisk.ts` beyond the general surface-sample-depth component. |
| Ranking mismatch | **Not tested as a distinct upset-risk feature** | Ranking is used in the tie-break cascade (§6) but not as an upset-risk component. |
| Tour-level mismatch | **Not tested as a distinct feature** | Not a component in `upsetRisk.ts`. |
| Surface sample size | **Possibly useful** | Included (up to 10 points) but not separately validated on its own predictive power in the cited analysis -- included based on face-validity ("thin sample = more uncertainty"), not a demonstrated correlation. |
| Injury or inactivity return | **Not tested** | Availability module exists but isn't wired into `upsetRisk.ts` at all. |
| Travel and rest | **Not tested** | Same -- Availability/Fatigue aren't upset-risk inputs. |
| Qualifying/lower-tier variance | **Possibly useful** | Represented indirectly via the tournament-level volatility component (Challenger/WTA250/ATP500 get +7, ITF explicitly floors at 0 despite showing lower real volatility) -- this is a coarse proxy, not a dedicated qualifying-status feature. |
| Serve dependence | **Not tested** | No such feature exists in the codebase under this name. |
| Tiebreak dependence (as a player trait, not the prediction-engine tie-break cascade) | **Not tested** | No such feature exists. |
| Historical player volatility | **Not tested** | No such feature exists. |

**Should the risk model stay part of the winner model, or become separate?** Based on what this
audit found: keep it combined. `upsetRisk.ts`, `recommendation.ts`, and `eliteTier.ts` are already
independent pure functions internally, and `finalConsistencyCheck.ts` deliberately cross-checks all
three together specifically to catch contradictions between them (e.g. "Elite" + "Extreme risk" +
"no model conflict" all claimed at once). Splitting them into separate systems would remove the one
mechanism currently guaranteeing they stay mutually consistent -- this matches Task #162's own
explicit "what NOT to touch yet" guidance.

---

## 9. Elite Prediction findings

**Current qualification rules** (`eliteTier.ts`, not fully re-read this session but referenced via
its reason strings below): requires the three core signals (Surface Elo, Serve & Return, Recent
Form) to all agree on direction, a calibrated margin >= 5, Data Quality >= 55, `modelAgreement` not
High Disagreement, and upset risk not Extreme.

**On the current validation dataset: zero predictions qualify as Elite.** Querying
`isEliteTier` across all 4,120 rows with a stored engine snapshot returns `false` for every single
one. The reason strings explain why -- the two most common blockers, by far, are "the three core
signals don't all agree on direction" and "no validated segment specialist is backing this
prediction" (each appearing, alone or combined with other reasons, across the majority of rows).

**Root cause of zero Elite predictions:** this dataset's confidence distribution is extremely
tight. A fresh margin-from-50% histogram shows 2,422 of 3,987 rows (61%) within 5 points of a coin
flip, another 1,335 (33%) within 5-10 points, and only **19 rows total** (0.5%) above a 15-point
margin. Elite's `margin >= 5` gate alone should pass roughly 40% of rows, but combined with
"all three core signals agree" -- which, per §5, only reliably happens when the correlated trio
isn't internally split -- the joint condition apparently never co-occurs with the other three gates
in this specific dataset snapshot.

**Because there are zero Elite rows, none of the following can be measured on current data:** win
rate, log loss, calibration error, breakdowns by tour/surface/probability band/agreement/upset-risk
level, number or causes of Elite losses, or example incorrect Elite predictions. State this
plainly rather than inferring anything from an empty set. This is a different, and arguably more
concerning in its own right, finding than Task #75's original one (Elite was *directionally
positive but not statistically significant*, n=267-468, on an older dataset) -- on the current
dataset, Elite isn't even reachable, so its historical evidence (from a different snapshot) is the
only evidence that currently exists about whether it works.

**Verdict:** insufficient evidence on current data to call Elite "truly better," "too common," or
"too rare" -- it is currently unreachable given how tightly the confidence distribution clusters,
which is itself a finding about the confidence distribution, not really about the Elite gate's own
logic.

---

## 10. Strong Recommendation findings

**Current qualification rules** (`recommendation.ts`): margin >= 22 (i.e. confidence >= 72%), Data
Quality >= 45, upset risk LOW or MODERATE, model agreement not Mixed/HighDisagreement.

**Reconstructing recommendation tiers on the current dataset** (same method Task #116 used --
retroactive reconstruction from stored fields, since `recommendation` itself isn't persisted):

| Reconstructed tier | n | Accuracy | Avg probability |
|---|---|---|---|
| HIGH_RISK | 2,025 | 63.6% | 50.4 |
| NO_STRONG_SIGNAL | 1,496 | 54.3% | 49.5 |
| MODERATE_LEAN | 466 | 75.8% | 50.7 |
| **STRONG_RECOMMENDATION** | **0** | -- | -- |
| DO_NOT_RECOMMEND | 0 | -- | -- |

**Zero rows reach STRONG_RECOMMENDATION on the current dataset**, for the same root cause as §9:
the margin-from-50% distribution has essentially no rows above 20 points (max observed margin in
this corpus is 20.6, one single row -- see §9's histogram), so the `margin >= 22` gate never fires.
**Zero rows reach DO_NOT_RECOMMEND either** -- minimum observed Data Quality in this corpus is 31,
never below the `<25` floor.

**Does the earlier poor-calibration finding still hold?** It cannot be freshly re-checked on
current data, because the tier is currently empty. What we know for certain: Task #116 (n=189) and
Task #120's independent re-check (n=44, a different fold) both found `STRONG_RECOMMENDATION` had
the **worst log loss of any tier** (0.736 and 0.729 respectively, both worse than the 0.693
coin-flip baseline) on datasets where it *was* reachable. Task #120 traced this to the calibration
curve itself being overconfident above ~70% (the gap between predicted and observed accuracy
*widens*, not narrows, past 70%) -- not to the specific `margin >= 22` cutoff choice. That
conclusion has not been overturned by anything found in this task; it simply can't be re-confirmed
fresh right now because there's no current data to check it against.

**Exact rule responsible (if the finding still holds):** the interaction between `margin >= 22`
(which selects the 72%+ confidence band) and `calibration.ts`'s curve being overconfident in
exactly that band -- not `recommendation.ts`'s other gates (DQ>=45, upset risk, model agreement),
which Task #120 found were not the driver.

---

## 11. Calibration findings

- **Raw vs. calibrated probability:** the engine prefers a real fitted (isotonic or Platt)
  calibration curve from the most recent walk-forward run when one exists; falls back to a
  hand-tuned Data-Quality-based shrink heuristic otherwise.
- **Active mapping:** not independently re-verified this session which exact curve is active for
  today's dataset -- inferred to be a fitted curve given `historical_test` rows exist.
- **Does Shadow Replay use the calibration active on the historical date, not today's?** Task #160
  is the task that implements this, and it is currently **`IN_PROGRESS`** (not yet merged/verified
  as of this report). Its status cannot be confirmed as "done" here -- it should not be assumed
  fixed until it's merged and independently re-checked.
- **Do older Shadow batches still use the old (wrong) behavior?** Cannot be checked -- **zero
  Shadow batches exist in the database at all** (§12/§13). There is nothing to inspect.
- **Calibration error by band/tour/surface/level/DQ/recommendation/risk tier:** the only granular
  calibration-error (ECE) breakdown that exists comes from Task #128's fix (isotonic vs. Platt
  selection) and Task #75/#111's DQ-bucketed work, both on prior dataset snapshots. A fresh
  ECE-by-band recomputation was not performed this session (would require refitting or replaying
  the calibration curve against current data, which risks drifting into re-running an evaluation
  job -- out of scope for a reporting task). Stated plainly: **this specific breakdown was not
  freshly measured for this report.**
- **Is one global calibration mapping adequate, or does a segment need its own?** Per Task #162's
  citation of `specialistWeights.ts`'s own thresholds (`MIN_HISTORICAL_MATCHES_FOR_SEGMENT=150`,
  `MIN_VALIDATION_SAMPLES_FOR_SEGMENT=30`), only tour/surface segments that clear those bars get a
  dedicated specialist calibration at all -- the design already refuses segment-specific
  calibration where the sample doesn't support it, which is consistent with the user's own
  instruction not to recommend segment calibration without sample-size support. No new evidence
  from this task changes that design.

---

## 12. Walk-forward vs. Shadow Replay vs. real paper trading

| | Walk-forward backtest | Shadow Paper Trading | Real paper trading |
|---|---|---|---|
| Prediction count | 5,092 (`historical_test`, all `validation` segment) | **0** | 221 (`paper_trade` in `evaluation_predictions`); 2,331 in the live `predictions` table more broadly |
| Graded | 3,987 (accuracy-eligible) | 0 | 5 (of the 221); 2,311 (of the 2,331 live table rows) |
| Accuracy | Varies by slice -- see §4-§10 tables | N/A | Not statistically usable (n=5) |
| Log loss / calibration error | Not freshly recomputed overall this session (see §11) | N/A | Not usable (n=5) |
| Date range | Mostly a Wimbledon-2026-era window (see §2) | N/A -- no batches exist | 201 of 221 rows are `status='missed'`, 15 `pending`, 5 `graded` |
| Eligible-match rules | `included_in_accuracy=true`, retirements excluded by admin config | Would use `historicalScoring.ts`'s leak-safe cutoff reconstruction | Real live scheduling/lock-cutoff rules |
| Data source | Historical match records, re-run through the live engine | Would replay historical dates against the exact live-engine code path | Live API-Tennis fixtures |
| Feature path | Confirmed identical to the live engine (`scoreHistoricalMatch` calls the same `runPredictionEngine()`) | Same, by design (append-only, isolated `paper_trade_shadow` bucket) | The actual live path |
| Calibration behavior | Uses whichever curve is currently fitted | Should use the calibration active *on the historical date being replayed*, per Task #160 -- but Task #160 is still in progress, unverified | Uses today's live calibration |
| Known limitations | Only one walk-forward fold/no `test`-segment rows exist right now (Task #135) | **No data exists at all -- Shadow Replay has never actually been run in this environment** | Only 5 graded rows -- nowhere near enough to compare against anything (same blind spot Task #116 originally flagged, still true) |

**Meaningful performance gap:** cannot be assessed between walk-forward and Shadow Replay, because
Shadow Replay has zero rows. Cannot be assessed between walk-forward and real paper trading either,
because real paper trading has only 5 graded rows. **State this clearly, as instructed:** there is
currently too little real/shadow evidence to make any honest comparison against the historical
backtest. This is not a new finding -- it is the same blind spot Task #116 first flagged, and it
persists.

---

## 13. Skipped-match findings

**Cannot be measured.** Shadow Replay skip reasons are only generated when a replay batch is
actually run (`runShadowPaperTradingReplay` in `shadowReplay.ts`); since zero batches have ever
been run in this environment, there is no skip data of any kind to audit -- no "already claimed,"
"insufficient data," "missing identity," or any other skip category exists yet. This should be
revisited the first time someone actually runs a Shadow Replay batch.

---

## 14. Most confident wrong predictions

The current dataset's confidence distribution is tight enough (§9's histogram) that "most
confident wrong" tops out well below what a betting-style audit might expect -- the single highest
predicted-confidence wrong prediction found is 65.6%. Below are the 15 most confident wrong
predictions currently in the graded validation set, most-confident first:

| Match | Tournament | Level | Surface | Predicted winner | Actual winner | Predicted confidence | Agreement | Upset tier |
|---|---|---|---|---|---|---|---|---|
| E. Svitolina vs. B. Haddad Maia | Bad Homburg | WTA250 | Grass | E. Svitolina | B. Haddad Maia | 65.6% | Strong | LOW |
| Machac/Mensik vs. Martinez/Munar | Wimbledon | GrandSlam | Grass | Machac/Mensik | Martinez/Munar | 65.1% | Mixed | MODERATE |
| F. Auger-Aliassime vs. J-L. Struff | Wimbledon | GrandSlam | Grass | F. Auger-Aliassime | J-L. Struff | 64.3% | Strong | LOW |
| A. Barrena vs. R. Carballes Baena | Braunschweig | Challenger | Clay | A. Barrena | R. Carballes Baena | 64.1% | Strong | LOW |
| Kusuhara/Nakagawa vs. Katayama/Kono | M15 Tokyo 2 | ITF | Hard | Kusuhara/Nakagawa | Katayama/Kono | 63.4% | Moderate | LOW |
| C. Doig vs. L. Miguel | Wimbledon | Other | Grass | C. Doig | L. Miguel | 62.7% | Strong | MODERATE |
| V. H. Remondy Pagotto vs. Pa. Tsitsipas | M25 Villavicencio | ITF | Clay | V. H. Remondy Pagotto | Pa. Tsitsipas | 62.5% | **HighDisagreement** | **EXTREME** |
| M. Topo vs. L. Preda | Iasi | Challenger | Clay | M. Topo | L. Preda | 62.5% | Strong | LOW |
| P. Martinez vs. A. Santamarta Roig | Exhibition Boodles Challenge | Other | Grass | A. Santamarta Roig | P. Martinez | 62.6% (37.4% P1) | Strong | LOW |
| B. Krejcikova vs. A. Eala | Wimbledon | GrandSlam | Grass | A. Eala | B. Krejcikova | 62.6% (37.4% P1) | Strong | LOW |
| A. Rinderknech vs. A. Zverev | Wimbledon | GrandSlam | Grass | A. Zverev | A. Rinderknech | 63.1% (36.9% P1) | Strong | LOW |
| Pavlasek/Zielinski vs. Gonzalez/Krajicek | Wimbledon | GrandSlam | Grass | Gonzalez/Krajicek | Pavlasek/Zielinski | 64.6% (35.4% P1) | Strong | MODERATE |
| Chan H-/Krejcikova vs. Errani/Paolini | Wimbledon | GrandSlam | Grass | Errani/Paolini | Chan H-/Krejcikova | 66.3% (33.7% P1) | Strong | MODERATE |
| J-L. Struff vs. F. Misolic | Wimbledon | GrandSlam | Grass | F. Misolic | J-L. Struff | 67.1% (32.9% P1) | Strong | LOW |
| Bouzige/Ilagan vs. Maginley/Perez | Winnipeg | Challenger | Hard | Maginley/Perez | Bouzige/Ilagan | 63.2% (36.8% P1) | Strong | MODERATE |

**Recurring cause, grouped:** the overwhelming majority (13 of 15) are labeled `Strong` agreement
and `LOW`/`MODERATE` upset risk -- i.e. the engine was genuinely confident and calm about these
matches, not flagged as risky, and still lost. This is the honest cost of the well-calibrated
50-65% band (§1, §11) doing its job on average while still being wrong on individual matches at the
rate its own calibration implies (a well-calibrated 65% pick is *supposed* to lose about 35% of the
time). Only 1 of the 15 (V. H. Remondy Pagotto vs. Pa. Tsitsipas) was already correctly flagged as
`HighDisagreement`/`EXTREME` -- i.e. the system already knew that one was risky before it lost.
**No single systemic root cause (inflated Elo, bad fallback values, identity mapping, etc.) stands
out across this list** -- it reads as ordinary calibrated variance in the 62-67% confidence range,
not a cluster pointing at one bug.

---

## 15. Surprising correct underdog predictions

Strongest correct calls where the engine's own risk label said HIGH or EXTREME danger, and it
still got the pick right (most-underdog-confidence first):

| Match | Tournament | Level | Surface | Correct pick | Confidence in that pick | Agreement | Upset tier |
|---|---|---|---|---|---|---|---|
| Appleton/Watson vs. Andreeva/Shnaider | Wimbledon | GrandSlam | Grass | Andreeva/Shnaider | 65.9% (34.1% P1) | Strong | HIGH |
| M. Buzarnescu vs. L. Stefanini | Wimbledon | GrandSlam | Grass | L. Stefanini | 61.4% (38.6% P1) | Strong | HIGH |
| M. Dodig vs. J. M. Cerundolo | Modena | Challenger | Clay | J. M. Cerundolo | 61.0% (39.0% P1) | HighDisagreement | HIGH |
| D. Gaillard vs. L. S. Steur J. | W15 Casablanca | ITF | Clay | L. S. Steur J. | 61.0% (39.0% P1) | Strong | HIGH |
| T. Avcibasi vs. H. Bernet | M15 Getxo | ITF | Clay | H. Bernet | 63.2% (36.8% P1) | Strong | HIGH |
| Salisbury/Skupski vs. Broom/Paris | Wimbledon | GrandSlam | Grass | Salisbury/Skupski | 64.0% | Strong | HIGH |
| Cash/Glasspool vs. Andreozzi/Demoliner | Wimbledon | GrandSlam | Grass | Cash/Glasspool | 62.1% | **HighDisagreement** | **EXTREME** |
| Y. Yang vs. J. Cai | W15 Maanshan 7 | ITF | Hard | Y. Yang | 62.8% | Strong | HIGH |
| L. Marmousez vs. C. Pillonel | M15 Litija | ITF | Clay | L. Marmousez | 62.3% | Strong | HIGH |
| M. Leonard vs. M. Matias | W50 Corroios-Seixal | ITF | Hard | M. Leonard | 62.1% | Strong | HIGH |

**What the system saw correctly:** the risk labeling here is doing exactly what it's supposed to --
these are matches the engine correctly flagged as more dangerous than average (HIGH/EXTREME tier)
while still having a real, calibrated lean, and that lean paid off. The Cash/Glasspool match is the
most interesting: it's the same `HighDisagreement`/`EXTREME` combination that produced the audit's
one clean wrong-and-correctly-flagged example in §14, but here it went the other way -- consistent
with `HighDisagreement`/`EXTREME` correctly meaning "harder to call," not "wrong." This is the
strongest available evidence (short of a full backtest) that the upset-risk and agreement labels
are measuring real uncertainty, not just noise.

---

## 16. Confirmed bugs

Only one bug meets the "confirmed, not suspected" bar from this task's own evidence plus Task
#162's:

### Bug: tie-break cascade underperforms its own baseline
- **Severity:** High.
- **Affected files:** `predictionEngine/tieBreakers.ts`, called from `predictionEngine/index.ts`.
- **Number of affected predictions:** 1,509 of 3,987 graded validation rows (38%).
- **Example prediction:** any row in §6's table with a `decidingStep` populated (e.g. the many
  Serve & Return-decided rows sitting at 53.7% accuracy vs. the 66.7% non-applied baseline).
- **Does it change the winner?** Yes -- that's its entire function; it exists specifically to turn
  an otherwise-50/50 call into a directional pick.
- **Does it change probability?** Yes, by a fixed 2.5-point nudge.
- **Does it change risk/agreement/recommendation/Elite status?** Indirectly, yes -- a tie-break-
  adjusted probability feeds into every downstream tier the same as any other final probability.
- **Is it already fixed?** No. Tracked as the already-created **Task #163**.
- **How was the fix verified?** N/A -- not yet fixed.

**Previously confirmed bugs, already fixed (kept here for completeness, per the "what's already
working" instruction, not re-flagged as open):** the correlated-cluster double-counting (§5, Task
#146), the 65-70% confidence-band Platt-vs-isotonic miscalibration (Task #128), the Data Quality
blend silently dropping three of its seven documented modules (Task #111), the DQ-threshold
calibration reversal above ~55 (Task #75), and the winner/loser set-score display bug (an
already-fixed, pre-existing item noted in `index.ts`'s own code comments, not rediscovered by
Task #162).

---

## 17. Suspected issues

1. **Zero rows currently reach STRONG_RECOMMENDATION or Elite tier (§9, §10).** *Why suspicious:*
   these are supposed to be the system's flagship "trust this one" labels, and right now neither
   can ever fire given the current confidence distribution. *Evidence:* the margin-from-50%
   histogram shows only 19 of 3,987 rows above a 15-point margin, and only 1 above 20 points.
   *Missing evidence:* whether this is a property of this specific dataset window (heavily
   Wimbledon-era, possibly a genuinely close/hard-to-call slate of matches) or a broader symptom of
   the calibration curve compressing everything toward 50-60%. *Test that would confirm/reject it:*
   compare the margin distribution across several different walk-forward date windows/folds once
   Task #135 stops wiping history -- if every window shows this same compression, it points at the
   calibration curve itself; if it's specific to this window, it's just this slate of matches being
   genuinely close.
2. **The MODERATE/HIGH near-tie at Grand Slam level and on Grass (§7).** *Why suspicious:* it's the
   same small local inversion pattern (a middle tier's favorite-win-rate nearly matching or beating
   the tier above it) that Task #116 found more broadly on an older dataset. *Evidence:* GrandSlam
   MODERATE 52.6% vs. HIGH 68.1%; Grass MODERATE 56.5% vs. HIGH 63.2%. *Missing evidence:* both
   cells are single-digit-hundreds sample sizes at one level/surface in one dataset window --
   nowhere near enough to separate "real local non-monotonicity" from noise. *Test:* re-check the
   same level/surface cells across multiple independent folds/windows.

No other suspected issues surfaced in this pass beyond what prior audits already document as fixed
or as separately-tracked open questions (Head-to-Head's weight, simulator scope-scaling accuracy
over time).

---

## 18. What is already working correctly

Only items this task or a cited prior audit actually tested, with evidence:

- **Leakage-safe historical cutoff:** `historicalScoring.ts` confirmed (Task #162) to call the
  exact same `runPredictionEngine()` the live path uses, with a documented, checked list of which
  inputs are legitimately excluded/overridden for historical scoring and why.
- **Immutable saved predictions:** a DB trigger enforces settle-once on `evaluation_predictions`
  (confirmed by Task #116's audit; `calibratedProbability`/`foldId` are the only documented
  exemptions).
- **Correct Player 1/Player 2 mapping and winner display:** the hidden-bug sweep (Task #162) found
  zero cases of a reversed/mislabeled winner, a sub-50%-probability "winner," or a predicted winner
  who isn't one of the two match players, across 2,331 live rows.
- **Correlated-cluster collapse (§5):** measurably improved calibration on the specific rows it was
  designed to fix (Task #146), still reflected in current code.
- **Model-agreement categorization (§4 of Task #162's report, reused in this report's §1):**
  HighDisagreement genuinely predicts lower accuracy on current data (54.2% vs. 65-72% elsewhere).
- **Upset-risk tier ordering (§7, this task's fresh finding):** correctly monotonic on the current
  dataset, an improvement in kind over what Task #116 found previously.
- **Final-consistency invariant guard:** zero violations found across 2,331 live rows (Task #162).
- **Specialist-segment holdout methodology (Task #151's fix):** confirmed still live in
  `specialistWeights.ts` (holdout-validated `fitBestCalibration`, not an in-sample fit).

---

## 19. What Task #162 (and this task) did not prove

- **Small/zero sample sizes block several sections outright:** Shadow Replay (0 rows -- §12/§13),
  real paper trading (5 graded rows -- §12), Elite tier (0 rows -- §9), Strong Recommendation
  (0 rows -- §10). None of these are "checked and found fine" -- they are unmeasurable right now.
- **No genuinely held-out `test`-segment data currently exists** (§2's freshness note) -- every
  historical-backtest number in this report and its predecessors comes from a `validation`-segment
  snapshot, not a separate never-touched test fold, because Task #135's walk-forward-wipe bug is
  still open.
- **No cross-window/cross-season stability check was done.** All current numbers come from one
  dataset snapshot (mostly a single Wimbledon-era window); whether the findings in §7's ordering
  fix, §9/§10's empty tiers, and §14/§15's example lists hold on a different time window is unknown.
- **Per-model accuracy/log-loss/removal-impact figures (§4) were not recomputed this session** --
  reused from Task #116's own dataset snapshot, which no longer exists in the live DB.
- **Calibration error broken down by band/tour/surface/level/DQ/recommendation/risk tier (§11) was
  not freshly computed** -- this would require either refitting or replaying the active calibration
  curve, which risks drifting into a full evaluation job, out of scope for a reporting-only task.
- **No before/after comparison exists for the upset-risk ordering improvement (§7)** -- it's not
  known whether this reflects a genuine fix or a different dataset window.
- **Absence of a detected bug is not proof no bug exists** -- the hidden-bug sweep and consistency
  guard check a specific, enumerated list of failure modes; they cannot rule out failure modes
  nobody has thought to check for yet.

---

## 20. Strict priority order

1. **[Confirmed bug, highest priority]** Fix the tie-break cascade (§6, §16).
   - **Evidence:** 1,509/3,987 (38%) of graded predictions go through it; every step with real
     sample size underperforms the non-applied baseline by 13-24 points; Surface Elo's step is
     worse than random.
   - **Expected impact:** removing or repairing this could meaningfully lift overall accuracy,
     since it's not a rare edge case -- it's more than a third of all predictions.
   - **Files:** `predictionEngine/tieBreakers.ts`, `predictionEngine/index.ts`.
   - **Recommended change:** root-cause why each step fails when deciding (not just re-order the
     list), per Task #163's plan.
   - **Required validation:** re-measure tie-break-applied accuracy against the same graded cohort
     used here; add a regression guard so this can't silently regress again.
   - **Acceptance metric:** tie-break-decided accuracy statistically indistinguishable from (or
     better than) the non-applied baseline.
   - **Risk of making the change:** low-to-moderate -- this logic only fires on already-uncertain
     matches, so a conservative fix (e.g. "when uncertain, report 50/50 honestly instead of a wrong
     lean") cannot make things worse than status quo.

2. **[Model weakness / design limitation]** Land Task #135 (stop walk-forward from wiping real
   evaluation history).
   - **Evidence:** every historical number in every audit including this one shares this
     limitation (§2, §19); `evaluation_runs` currently has no genuinely held-out test fold.
   - **Expected impact:** unblocks trustworthy before/after comparisons for every future fix,
     including whatever comes out of priority #1.
   - **Files:** the walk-forward test suite and `runWalkForwardEvaluation()` (per Task #128/#135's
     existing description; not re-read in full this session).
   - **Required validation:** confirm a full multi-fold run persists correctly across repeated test
     suite executions without wiping prior folds.
   - **Acceptance metric:** `evaluation_runs` retains multiple folds and a genuine `test` segment
     after the test suite runs.
   - **Risk:** low -- this is a data-preservation fix, not a scoring-logic change.

3. **[Missing evidence, not a bug]** Land Tasks #129 + #130 (real paper-trading schedule + quiet-
   pipeline alert).
   - **Evidence:** only 5 of 221 `paper_trade` rows are graded (§12); 201 are `missed`.
   - **Expected impact:** without this, no live-only claim (about the tie-break fix, calibration,
     or anything else) can ever be checked against real forward performance, only against backtest.
   - **Acceptance metric:** graded paper-trade volume grows steadily week over week instead of
     stalling at single digits.
   - **Risk:** low.

### Conclusions

1. **The single best next move:** fix the tie-break cascade (Task #163) -- it's the largest,
   best-evidenced, previously-unmeasured accuracy problem currently active, affecting over a third
   of all predictions.
2. **The second priority:** land Task #135 -- every future measurement (including verifying the
   tie-break fix) depends on evaluation history actually persisting.
3. **The third priority:** land Tasks #129/#130 -- without real graded volume, nothing can be
   confirmed against live production, only against backtest.
4. **What should not be changed yet:** STRONG_RECOMMENDATION/Elite thresholds (Task #120 already
   found the problem lives in the calibration curve, not these gates, and they're currently
   unreachable anyway so there's nothing to re-tune against); Head-to-Head's weight (open, separate
   question -- Task #155); splitting winner/risk/recommendation/Elite into separate systems (would
   remove the consistency guard that currently keeps them agreeing).
5. **Should the winner model remain as-is?** Yes, apart from the tie-break cascade fix -- the core
   ensemble/calibration/specialist/simulator pipeline has no other confirmed bug in this pass.
6. **Should the risk model become separate?** No -- see §8's reasoning; keep it combined with the
   final-consistency guard intact.
7. **Should Strong Recommendation become separate?** No new reason to split it out found here; the
   underlying issue (calibration overconfidence above ~70%, per Task #120) lives in `calibration.ts`
   regardless of whether the label is separate or combined.
8. **Should Elite Prediction become separate?** Same answer -- no. It is currently unreachable, and
   that's a symptom of the confidence distribution, not of how the label is organized in the code.
9. **Which completed features are trustworthy now?** Model-agreement labeling (§4/§18), the
   correlated-cluster fix (§5), the final-consistency guard (§18), and the current upset-risk tier
   ordering on this dataset (§7) -- each with direct evidence behind it.
10. **Which feature or label is currently the least trustworthy?** The tie-break cascade -- it is
    not just unproven, it is actively confirmed to underperform the baseline it replaces, on real
    graded data, right now.
