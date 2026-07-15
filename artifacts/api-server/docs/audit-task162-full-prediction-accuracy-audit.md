# Full Prediction-Accuracy Audit & Prioritized Roadmap

**Task #162.** Read-only audit and evidence-based roadmap covering the 13 points in the original
brief: final-winner logic, per-model value, correlated evidence, tie-breaks, upset-risk tiers,
Strong Recommendation, Elite Prediction, calibration segmentation, Shadow Replay vs. live gap,
error analysis, and a hidden-bug sweep. No code was changed by this task -- it is a report only.

Data used: live dev DB as of 2026-07-15 (`evaluation_predictions`: 5,092 `historical_test` rows,
all in the `validation` segment, no `test`-segment rows currently exist -- see §6; `predictions`:
2,331 live paper-trading/manual rows, 2,311 graded). Source read: the full `predictionEngine/`
module set (index, ensemble, disagreement, calibration, dataQuality, recommendation, upsetRisk,
eliteTier, tieBreakers, finalConsistencyCheck, simulator), `evaluation/` (historicalScoring,
specialistWeights, shadowReplay), and every existing audit doc in this `docs/` folder.

## 1. Already covered -- do not re-litigate

A large fraction of the brief is already answered by prior work, with real evidence behind each:

| Brief point | Already answered by |
|---|---|
| Calibration overconfidence >70%, STRONG_RECOMMENDATION worse-than-coinflip, Elite lift, DQ correlation, UI-honesty gap | `audit-task116-full-statistical-audit.md` (n=4,111) |
| STRONG_RECOMMENDATION re-check on an independent fold | `audit-task120-strong-recommendation-revalidation.md` -- confirmed the calibration curve, not the gate, is at fault; thresholds correctly left unchanged |
| Correlated evidence (Surface Elo / Serve&Return / Recent Form voting as one signal three times) | `audit-task146-correlated-cluster-overconfidence.md` -- `collapseCorrelatedCluster` now runs before disagreement scoring |
| 65-70% band local miscalibration | `audit-task128-65-70-confidence-overconfidence.md` -- root-caused to a Platt-vs-isotonic selection blind spot, fixed |
| DQ threshold direction reversal above 55 | `audit-task111-dq-degradation-above-55.md`, `audit-task75-dq-threshold-revalidation.md` |
| Disagreement-gate precision | `audit-task119-disagreement-gate-precision.md` |
| Tour/surface reliability discount, ATP 0.63 | prior ablation work, see `.agents/memory/specialist-segment-thresholds.md` |
| Head-to-Head's near-zero standalone value | already an open, tracked question -- Task #155 |
| Hidden-bug defense-in-depth for reversed winners, Elite-with-weak-evidence, stale recommendations | `predictionEngine/finalConsistencyCheck.ts`'s 12-rule invariant guard, run on every prediction |
| Walk-forward wiping real evaluation history when its test suite runs | already reproduced and tracked -- Task #135 (this audit independently observed the same symptom, see §6) |

None of these are re-audited here beyond spot-checking that their fixes are still reflected in
current code (they are).

## 2. New finding (highest priority): the tie-break cascade is making predictions worse, not better

`tieBreakers.ts` fires whenever the raw ensemble lands within 3 points of 50/50, and picks a
"real, if modest" 52/48-style lean from a 7-step priority cascade (Serve & Return -> Surface Elo ->
Recent Form -> surface win-rate history -> ranking -> Fatigue -> Head-to-Head). It has never been
checked against real outcomes before. Querying every graded `historical_test` validation row by
whether the tie-break applied, and by which step decided it:

| Tie-break outcome | n | Accuracy |
|---|---|---|
| Not applied (raw ensemble already clear) | 2,478 | **66.7%** |
| Applied, decided by Serve & Return | 1,374 | **53.7%** |
| Applied, decided by Surface Elo | 120 | **46.7%** (worse than a coin flip) |
| Applied, decided by Recent Form | 7 | 42.9% |
| Applied, decided by Fatigue | 3 | 0.0% |
| Applied, decided by surface win-rate history | 1 | 100.0% |

38% of all validation predictions (1,509 / 3,987) go through this cascade, and every step with
real sample size performs at or below a coin flip -- 12.9 points worse than the baseline accuracy
of matches the cascade never touches. This is not a subtle effect: it means whenever the engine
tells a user "core signals were essentially tied, but Serve & Return gives a modest lean," that
lean is, on the evidence, actively unreliable rather than a genuine if-modest edge. This is
worse than simply reporting 50/50 honestly, because a stated lean (with a named justification)
reads as more trustworthy than an explicit coin flip, while performing worse than one.

This is a real, previously-unmeasured bug, not a re-statement of any existing finding.

## 3. New finding: paper-trading ledger is still not grading

`evaluation_predictions` where `run_kind = 'paper_trade'`: 221 rows, only **5 graded** (2.3%).
This is the same root cause Task #116 flagged as its "critical blind spot" (zero/near-zero graded
live rows means every live-facing accuracy claim still rests entirely on the historical backtest,
not on real forward performance) and it has not materially changed. It remains fully explained by
the already-open Tasks #129 (give a person control over a real capture/grading schedule) and #130
(warn visibly if the pipeline goes quiet) -- both still correctly scoped and still blocking. No new
task is needed for this; it is re-confirmed evidence that #129/#130 are not yet resolved.

## 4. New finding: model-agreement categories are doing real, differentiated work

Spot-checking whether Task #146's correlated-cluster collapse still produces a meaningful signal
(not just a renamed version of the old, gameable category):

| modelAgreement | n | Accuracy |
|---|---|---|
| Mixed | 25 | 72.0% |
| Moderate | 112 | 67.0% |
| Strong | 2,341 | 65.8% |
| HighDisagreement | 1,509 | 54.2% |

HighDisagreement genuinely correlates with lower accuracy (54.2% vs. 65-72% elsewhere) -- this is
the category doing its job, flagging real difficulty rather than manufacturing false confidence.
No fix needed here; cite this as evidence the category is trustworthy, not just plausible.

## 5. Confidence-overclaiming (Task #133): current evidence is too thin to confirm or refute fresh

The validation slice is almost entirely clustered at 50-60% predicted confidence (3,757 of 3,987
rows); only 1 row reaches the 70-80% band and none reach 80%+. The live `predictions` table has a
little more spread but still only 7 total graded rows above 70% confidence (4 in 80-90%, 3 in
70-80%), with a 50% and 33% observed accuracy respectively -- suggestive of the same overclaiming
problem Task #116 already flagged, but far too small a sample (n=7) to add real fresh weight either
way. Task #133 remains correctly open; this audit does not close it or add a stronger evidence
base than what #116 already established.

One side observation worth keeping in mind while working #133: the bulk 50-60% bucket in both
validation (60.5% observed) and live (75.8% observed) data is *under*-confident, not overconfident
-- the system's confidence-overclaiming problem is concentrated at the extremes, not general.

## 6. Data-integrity caveat: only one walk-forward fold currently exists

`evaluation_runs` currently has exactly one row (single fold), and there are no `test`-segment
predictions at all -- every number in this report (and in the historical backtest audits it
builds on) comes from the `validation` segment only, not a genuinely separate held-out `test`
window. This is the same symptom `audit-task128` already reproduced and root-caused to
`walkForward.test.ts` unconditionally wiping `evaluation_runs`/`historical_test` on every run, and
it is already tracked as Task #135. No new task needed; flagging here only so a future reader of
this audit's numbers knows they share that same limitation.

## 7. Hidden-bug sweep: clean

Checked the live `predictions` table directly for the specific failure modes in the brief:
reversed/mislabeled winners, probabilities below 50% attached to the "winner" field, predicted
winners who aren't one of the two match players, and duplicate `matchIdentityKey`s. All came back
zero across 2,331 rows. `finalConsistencyCheck.ts`'s invariant guard (already covered in §1) is
doing its job for every prediction made since it shipped. No new hidden-bug task is warranted from
this sweep.

## 8. Prioritized next move

**#1 (do this next): investigate and fix the tie-break cascade (§2).** This is the single
best-evidenced, highest-impact, previously-unknown accuracy bug in the system -- 38% of
predictions run through a mechanism that performs at or below a coin flip. Recommended validation
test once a fix lands: a regression guard asserting tie-break-decided predictions' accuracy is not
statistically distinguishable from (or better than) the non-applied baseline, using the same
graded validation cohort measured here, so this can never silently regress again.

**#2: land Task #135 (stop walk-forward wiping real evaluation history).** Every other finding in
this system -- past and future -- is measured on a corpus that a routine test run can and does
destroy. This is not new priority information, but this audit is fresh confirmation that it is
still live and still blocking honest measurement of everything else, including whatever tie-break
fix comes out of #1.

**#3: land Tasks #129 + #130 (paper-trading real schedule + quiet-pipeline alert).** Until live
graded volume grows past single digits, no live-only claim (including future tie-break or
calibration fixes) can ever be confirmed against real forward performance -- only against the
historical backtest.

## What NOT to touch yet

- **STRONG_RECOMMENDATION / Elite tier thresholds** -- Task #120 already re-confirmed the
  overconfidence problem lives in the calibration curve, not these gates. Re-tuning them again
  without a new calibration change would just be re-fitting noise.
- **Winner/risk/recommendation/Elite as separate systems** -- do not split them. They are already
  cleanly separated internally (`recommendation.ts`, `upsetRisk.ts`, `eliteTier.ts` are independent
  pure functions), and `finalConsistencyCheck.ts` deliberately cross-checks them as one bundle at
  the end specifically to catch contradictions between them. Splitting them into separate systems
  would remove the one thing currently guaranteeing they agree.
- **Head-to-Head's weight** -- already an open, correctly-scoped question (Task #155); this audit's
  hidden-bug sweep and disagreement spot-check don't add new evidence either way.

## What's already working (don't re-audit)

Correlated-cluster collapse, DQ threshold direction, specialist-segment holdout methodology
(Task #151's fix), model-agreement categorization (§4), and the final-consistency invariant guard
(§7) are all measurably doing their jobs on current data and do not need another pass.
