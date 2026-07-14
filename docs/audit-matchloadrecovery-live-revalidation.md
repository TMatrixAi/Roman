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

## Live ablation re-validation: started but not completed this session

Per this task's own rule ("only keep it live if the ablation shows real accuracy benefit"), the
correct next step was to run the non-destructive ablation replay with `matchLoadRecovery`
temporarily removed from `EXCLUDED_FROM_ENSEMBLE` (so the baseline vote could actually include it
-- `moduleEdges` filters through that set unconditionally, so a hard-excluded module can never
appear in an ablation baseline and its leave-one-out delta would otherwise be meaningless), then
reading its leave-one-out delta. This was started three times via
`POST /api/evaluation/ablation/run` (full run = baseline + 9 leave-one-out + 4 combo = 14 variants
over 18,242 matches each):

- Attempt 1 reached variant 5/14 before the API Server workflow was restarted for an unrelated
  reason and the in-memory job was lost.
- Attempt 2 was still in the "baseline" phase when this task's first completion attempt was
  reviewed and rejected (`matchLoadRecovery` was still hard-excluded at that point, which the
  review correctly flagged as making any such run non-informative for this module).
- Attempt 3 (with `matchLoadRecovery` genuinely included in the baseline) reached
  variant 1/14, matchIndex ~2000/18242 before being stopped by explicit instruction.

**No completed leave-one-out delta for `matchLoadRecovery` exists.** No `reports/*.json` / `.md`
ablation report captures a finished number for this module.

### Observed pace / time-to-completion estimate

Attempt 3's baseline pass (18,242 matches) completed in ~7 minutes (started 05:33:26 UTC, entered
the "variants" phase by ~05:40:xx UTC), i.e. roughly **40-45 matches/second** sustained. At that
rate, one full run (14 variant passes, each a fresh 18,242-match walk-forward replay) needs
**roughly 95-115 minutes (~1.5-2 hours) of wall-clock time, uninterrupted** -- the ablation job
blocks the Node event loop while running, so nothing else on the API Server can be served
concurrently, and any workflow restart during the run loses all progress (no checkpointing).

## Decision made in the absence of a finished result

`matchLoadRecovery` was added to `EXCLUDED_FROM_ENSEMBLE` (`dataQuality.ts`) -- it is **computed
and displayed on every prediction, but does not vote** in `calibratedProbability`. This mirrors
how Availability was excluded pending its own proof, and is the conservative reading of "only keep
it live if the ablation shows real accuracy benefit": without a finished, positive result, the
default must be excluded, not included.

It is **not** excluded from `EXCLUDED_FROM_DATA_QUALITY`, matching Fatigue/Availability -- it still
counts toward the Data Quality score.

## What a follow-up needs to do

1. Run `POST /api/evaluation/ablation/run` to completion (expect ~15-20 min per variant x 14
   variants at this session's observed pace -- poll `GET /api/evaluation/ablation/status` with a
   long-timeout client; the endpoint itself blocks on the event loop while a variant is running).
2. Read the `matchLoadRecovery` leave-one-out delta from the finished report.
3. If removing it hurts overall accuracy (mirroring how Availability's inclusion was judged): remove
   `"matchLoadRecovery"` from `EXCLUDED_FROM_ENSEMBLE` in `dataQuality.ts` so it starts voting, and
   update this doc + `EXCLUDED_FROM_ENSEMBLE`'s comment with the real measured numbers.
4. If removing it doesn't hurt (or helps): leave it excluded, and replace this doc's "not yet
   measured" language with the real negative/neutral result and its number, exactly as
   `docs/audit-phase45-availability-revalidation.md` did for Availability.
5. Either way, compare the real measured module-vote-share shift against
   `docs/audit-fatigue-redesign-investigation.md`'s predicted renormalization table (Surface
   Elo/Serve&Return/Recent Form/Head-to-Head shifting down ~0.5-1.9pp each) to confirm or correct
   that prediction with real ablation output -- this was this task's explicit "Done looks like"
   requirement and could not be closed out this session.
