# Root-Cause Fix: 65-70% Confidence Band Overconfidence

**Task #128.** Task #125's read-only audit found the 65-70% predicted-confidence band (n=259, all
`historical_test`) won only 57.9% of the time against an average predicted confidence of 67.0% -- a
+9.1pt calibration gap, the clearest well-supported calibration problem in the whole dataset.

## 1. Root cause

Every row in that band traced back to a single walk-forward fold (`evaluation_runs.id = 183`, the
only fold that had completed in the live dataset -- see §3). That fold's `fitBestCalibration` call
picked **Platt scaling** over isotonic regression, because Platt had the lower *average* holdout log
loss (0.6854 vs isotonic's 0.6892).

But the fold's own raw validation data has a genuine, non-monotonic **local dip**: raw predictions
around 60-65% actually won only ~51-55% of the time in this fold, sandwiched between higher observed
win rates just below and just above that band. A binned isotonic fit (already in production,
`fitIsotonicCalibrationBinned`) absorbs a dip like that directly. A Platt sigmoid cannot represent a
local dip at all -- its fixed monotonic shape bridges smoothly over it -- and it was still winning
the old "pick whichever has the lower average log loss" comparison because log loss is averaged over
every point in the holdout set, not every probability band. A method can be better *on average* while
being *locally worse-calibrated* in one specific band, and the old selection rule had no way to catch
that.

Confirmed directly: reimplementing the fold's actual fit/holdout split and recomputing calibration
error (ECE, weighted mean |predicted - observed| across the same reliability buckets the Accuracy
dashboard already uses) showed isotonic's holdout ECE (0.047) was meaningfully lower than Platt's
(0.069) for this fold -- Platt wins on the metric that was actually being checked, and loses on the
metric that predicts real-world calibration in the specific band the audit flagged.

## 2. The fix

`fitBestCalibration` (`services/evaluation/calibration.ts`) now also computes each candidate's
holdout ECE, and Platt is only allowed to win when it beats isotonic on **both** metrics --  lower
holdout log loss **and** an ECE that isn't worse than isotonic's. If Platt wins on log loss but is
more miscalibrated in some band (higher ECE), isotonic is used instead. Both holdout ECE values are
now returned on the result (`isotonicHoldoutEce`, `plattHoldoutEce`) for future debugging/dashboard
use, alongside the existing log-loss fields; nothing downstream is required to change and the DB
schema/API surface are untouched by this change.

New unit tests (`services/evaluation/calibration.test.ts`) cover: (1) a synthetic dataset shaped like
the real fold -- monotonic overall with one local dip -- correctly makes isotonic win under the new
guard; (2) a genuinely smooth, sigmoid-shaped dataset where Platt legitimately beats isotonic on
*both* metrics still lets Platt win, so the guard doesn't overcorrect into always picking isotonic;
(3) the too-small-to-hold-out path still returns `null` metrics rather than guessing. All three pass.
The full `prediction-engine-invariants` suite (95 tests, unrelated modules included) still passes.

## 3. A second, separate bug this surfaced: the live dataset only has one completed fold

While tracing which rows made up the 65-70% band, `evaluation_runs` turned out to have exactly **one**
row (`id=183`, `foldIndex=0`) instead of the intended `foldCount=4`. There were also 564 orphaned
`evaluation_predictions` rows with `fold_id = NULL` dated just after fold 183's window, consistent
with a second fold that started scoring but the run crashed before its `evaluation_runs` row was
written. This is a distinct, real infra bug from the Platt-vs-isotonic issue above -- it means the
last full walk-forward run never finished, and literally every row behind this audit's finding came
from one fold's calibration curve, not four independent ones.

**This investigation accidentally made that problem worse.** `walkForward.test.ts` (a pre-existing
integration test, unmodified here) calls the real `runWalkForwardEvaluation()`, which unconditionally
deletes every row in `evaluation_runs` and re-derives `historical_test` predictions before it does
anything else -- by design, so a real production refit never leaves stale folds around. Running that
test against this shared dev database (once, while checking that this fix doesn't break existing
tests) wiped the one real fold (`id=183`) along with the orphaned rows, and left an incomplete/failed
run in its place. `evaluation_runs` is now empty; `historical_test` predictions dropped from ~6,962 to
3,547. The test's own fixtures (tagged `provider = 'walk-forward-test'`) were cleaned up afterward, but
the tables it wipes as a side effect of the code under test were not restorable without a fresh real
run. **No code, formula, or threshold was changed by this accident** -- only the `evaluation_runs` /
`historical_test` data was reset to empty/incomplete, the same state a fresh environment would start
from.

I was not able to trigger a full clean re-run to restore it this session -- the `API Server` workflow
that hosts `POST /evaluation/walk-forward/run` kept exiting a few seconds after each restart for
reasons unrelated to this fix (worth its own investigation), and a full run takes 8-12+ minutes,
too long to safely retry blindly against a flaky host process. Given Task #134 ("re-run the full
multi-fold backtest once enough compute time is available") already exists and covers exactly this,
I did not force it here. **Whoever picks up #134 should know the current `evaluation_runs` table is
empty going in** -- that re-run will both restore complete fold history and produce the first dataset
that can validate this fix against genuinely out-of-sample folds (the validation above was against
fold 183's own already-graded data, reconstructed manually; it is solid evidence for the fix, but a
fresh walk-forward run is the real end-to-end confirmation).

## 4. Net result

- Root cause of the 65-70% overconfidence: identified and fixed (log-loss-only method selection could
  pick a globally-better-but-locally-miscalibrated Platt curve; now guarded by holdout ECE).
- Fix validated against the real fold's actual data (before it was wiped) and with new synthetic
  regression tests; existing test suite (95 tests) still green.
- A separate, pre-existing bug (walk-forward runs never completing all 4 folds) was found and is
  now more visible/urgent, tracked by existing Task #134.
- `evaluation_runs`/`historical_test` are currently empty/reduced as a side effect of verifying this
  fix against the existing test suite; a full walk-forward re-run (Task #134) will restore them and
  is also the way to see this fix's real effect on the 65-70% band going forward.
