# Match Load Recovery: live-wiring and re-validation status (Task #93)

## What this task did

Task #91 validated a redesigned "went-the-distance" recovery signal
(`computeMatchLoadRecoveryModule` in `matchLoadRecovery.ts`) as a standalone replacement
candidate for the old Fatigue module's recency-count approach. That module was fully built and
tested but never wired into the live ensemble. This task:

1. Wired `computeMatchLoadRecoveryModule` into `runPredictionEngine` (`predictionEngine/index.ts`)
   -- it now runs on every prediction, alongside the other modules.
2. Added it to the `EngineBreakdown` API contract (`lib/api-spec/openapi.yaml` ->
   `MatchLoadRecoveryResult` schema, regenerated `@workspace/api-zod` /
   `@workspace/api-client-react` via `orval`), so it round-trips through the API like every other
   module. It's optional/absent-safe: predictions made before this field existed still parse.
3. Added a "MATCH LOAD RECOVERY" card to the prediction UI (`PredictionResult.tsx`), following the
   same `EdgeBar` + informational-note pattern as Fatigue, with an explicit "new, thin, single-bit
   signal" disclosure and a note that rest days shown are informational only (they don't feed the
   risk score -- rest-days-only scoring, Candidate A, was tested in Task #91 and rejected).
4. Added `matchLoadRecovery` to `AblationModelKey`, `MODULE_IMPORTANCE` (0.4), `ENSEMBLE_WEIGHT_PRIOR`
   (0.3), and the ablation harness (`MODEL_DEFS` / `categorizeModelName` in
   `services/evaluation/ablation.ts`) so it can be ablated and voted on for real via
   `POST /api/evaluation/ablation/run`, mirroring the Availability precedent
   (`docs/audit-phase45-availability-revalidation.md`).

## Live ablation re-validation: COMPLETE (sampled, Task #96, 2026-07-14)

Two earlier full-corpus attempts (documented in prior revisions of this doc) never reached a
usable result -- the harness has no checkpointing, a full 18,242-match x 14-variant run takes
~1.5-2 hours uninterrupted, and one full-corpus attempt reached the Match Load Recovery variant
with the module still hard-excluded from the baseline, making the comparison a structural no-op.
This task closed the gap with a **sampled** run sized to finish in one sitting, and fixed a repeat
of the same no-op mistake before trusting the result (see "First sampled attempt was also a
no-op" below).

### Method: representative stratified sample, not a full-corpus or recent-date run

The ablation harness (`buildRepresentativeSample` in `ablation.ts`) drew **4,001 matches** from
the full 18,242-match eligible corpus, proportionally stratified by (surface x calendar year) so
the sample mirrors the corpus's real surface/time mix rather than skewing toward recent matches or
one surface. Match-history/Elo context for every sampled match was still built from the **full**
corpus, so leak-proof history reconstruction is exactly as accurate as a full run -- only which
matches were *scored* was reduced. Observed strata (all corpus matches happen to be dated 2025):

| Surface | Corpus count | Sample count |
|---|---|---|
| Hard | 11,333 | 2,485 |
| Clay | 5,142 | 1,128 |
| IndoorHard | 1,322 | 290 |
| Grass | 227 | 50 |
| Unknown | 218 | 48 |

### First sampled attempt was also a no-op -- caught and re-run

The first sampled run (also 4,001 matches) reported an exact **0.0pp delta on every single
segment** for `matchLoadRecovery` (identical `n` and accuracy in baseline vs. ablated, down to
every surface/tour/data-quality bucket). That is the signature of a structural no-op, not a real
null result: `matchLoadRecovery` was still present in `EXCLUDED_FROM_ENSEMBLE` at the time, so the
ablation "baseline" already excluded it from the vote, and "removing" it in the leave-one-out
variant changed nothing because it was never voting in either arm -- the exact failure mode this
doc's earlier revision warned a follow-up to avoid. `matchLoadRecovery` was temporarily removed
from `EXCLUDED_FROM_ENSEMBLE`, the API Server restarted, and the ablation re-run from scratch.

### Real result (matchLoadRecovery genuinely voting in the baseline)

- **Overall accuracy: 57.3% with it voting, 57.3% without (delta = 0.0pp)**, n=2,820 predictions
  scored both ways (out of 4,001 sampled matches -- see the report's own baseline `n` for why
  scored count differs from sample count, unrelated to this change).
- Removing it **does change individual predictions**: 83 of 2,820 predictions (~2.9%) flip winner
  when the module is removed. Those 83 flipped predictions score only 50.6% correct on their own --
  close to coin-flip -- so the flips roughly cancel out and don't move the aggregate number either
  way.
- Per-surface and per-tour deltas are inconsistent in sign and sit on small subsamples (Grass
  +5.7pp on n=35, IndoorHard -1.3pp on n=227, Junior -3.7pp on n=27, WTA +1.2pp on n=248) -- this
  reads as sampling noise on thin slices, not a real surface- or tour-specific edge, since a
  genuine effect would be expected to point the same direction across at least the larger surfaces
  (Hard n=1,738 and Clay n=820 both show ~0.0-0.1pp, i.e. no effect where the sample is largest).

### Representativeness and statistical significance

4,001 matches (2,820 scored predictions) stratified proportionally by surface and year is a
substantial, representative slice of the 18,242-match corpus (~22%) -- not a recent-date slice,
and every surface present in the corpus is represented at its true proportion. A true 0.0pp
overall effect on a base rate of ~57% with n=2,820 is a stable, low-noise measurement; the module's
own standalone validation (Task #91, `docs/audit-fatigue-redesign-investigation.md`) already found
just a 2-6pp edge above coin-flip depending on surface, so an ensemble-level null result is
plausible -- the module's already-weak standalone signal is easily absorbed/swamped once blended
with stronger modules (Surface Elo, Serve & Return, Recent Form) at ensemble weight 0.3.

## Decision: matchLoadRecovery stays excluded from ensemble voting

`matchLoadRecovery` remains in `EXCLUDED_FROM_ENSEMBLE` (`dataQuality.ts`) -- it is **computed and
displayed on every prediction (with its "new, thin, single-bit signal" disclosure), but does not
vote** in `calibratedProbability`. Per this task's own rule ("only keep it live if the ablation
shows real accuracy benefit"), a measured 0.0pp overall delta does not clear that bar. This mirrors
how Availability was judged, using the same ablation methodology.

It is **not** excluded from `EXCLUDED_FROM_DATA_QUALITY`, matching Fatigue/Availability -- it still
counts toward the Data Quality score.

## Vote-share renormalization: not applicable

Because the decision is to keep `matchLoadRecovery` excluded, the module-vote-share
renormalization predicted in `docs/audit-fatigue-redesign-investigation.md` (Surface
Elo/Serve&Return/Recent Form/Head-to-Head shifting down ~0.5-1.9pp each, matchLoadRecovery gaining
+6.0%) never actually applies to the live ensemble -- that table was explicitly conditional on
adoption ("if/when adopted"), and adoption did not happen. No correction to that table is needed;
it documents a hypothetical that was tested and did not clear the bar.
