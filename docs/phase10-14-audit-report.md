# Phase 10-14 Completion Report (Read-Only)

Date: 2026-07-23
Scope: Final deliverables 10-14 from the master task.
Mode: Read-only audit. No code, thresholds, weights, calibration, database records, or production configuration were modified.

## 10) Elite + High-Risk audit

### What the current engine does

Execution order in the prediction pipeline:

1. Compute upset risk and recommendation.
2. Compute Elite tier gates.
3. Run final consistency guard.
4. If guard has violations, force Elite to false.

Primary path:
- `runPredictionEngine` computes upset risk before Elite gating in [artifacts/api-server/src/services/predictionEngine/index.ts](artifacts/api-server/src/services/predictionEngine/index.ts#L710).
- Elite eligibility is decided in [artifacts/api-server/src/services/predictionEngine/eliteTier.ts](artifacts/api-server/src/services/predictionEngine/eliteTier.ts#L101).
- Final guard can still invalidate Elite in [artifacts/api-server/src/services/predictionEngine/finalConsistencyCheck.ts](artifacts/api-server/src/services/predictionEngine/finalConsistencyCheck.ts#L107).

### Gate behavior relevant to contradictions

Elite is explicitly blocked when either condition is true:
- upset risk is HIGH or EXTREME
- model agreement is HighDisagreement

This is enforced directly in `computeEliteTier` via explicit fail reasons.

A second defense exists in `checkFinalConsistency`:
- if `isEliteTier` is true while upset risk is HIGH/EXTREME or model agreement is HighDisagreement, it records a Rule 4 violation
- the engine then withholds Elite when any violations exist

### Verdict

For new predictions in the current code path, Elite + High Risk should not be possible.

Observed caveat:
- Legacy snapshots/backups may still contain rows scored under older gate logic; this does not reflect current runtime behavior.

## 11) Live Search vs Paper Trading audit

### Shared logic

Both paths call the same engine function:
- `runPredictionEngine` from [artifacts/api-server/src/routes/predictions.ts](artifacts/api-server/src/routes/predictions.ts#L150)
- `runPredictionEngine` from [artifacts/api-server/src/services/evaluation/paperTrading.ts](artifacts/api-server/src/services/evaluation/paperTrading.ts#L170)

### Where divergence is introduced

Even with shared engine logic, input context is different by design:

1. Snapshot timing mismatch
- Paper trading locks at cutoff (`scheduledStart - leadMinutes`) and persists a frozen pre-match snapshot in `evaluation_predictions`.
- Live search/ledger computes at request time.
- Sources: [artifacts/api-server/src/services/evaluation/paperTrading.ts](artifacts/api-server/src/services/evaluation/paperTrading.ts#L91), [artifacts/api-server/src/routes/predictions.ts](artifacts/api-server/src/routes/predictions.ts#L150)

2. Weather input mismatch
- Paper trading passes upcoming weather for scheduled fixtures.
- Live search path intentionally passes `weather: null`.
- Sources: [artifacts/api-server/src/services/evaluation/paperTrading.ts](artifacts/api-server/src/services/evaluation/paperTrading.ts#L184), [artifacts/api-server/src/routes/predictions.ts](artifacts/api-server/src/routes/predictions.ts#L217)

3. Fixture metadata certainty mismatch
- Paper trading uses provider fixture context (`surface`, `matchFormat`, `tournamentLevel`, `scheduledStart`).
- Live search depends on request payload values; quality may differ.

4. Identity binding mismatch risk
- Paper trading starts from fixture player ids and then resolves profiles.
- Live search starts from user-supplied ids.
- Any alias/source-id mismatch can produce materially different history pulls.

### Severity

Medium to high for user trust when users expect identical pre-match results between interfaces.

### Exact divergence point (architectural)

Divergence starts before engine scoring: the two flows construct different input snapshots.

## 12) Ranking-gate audit

### Direct ranking/tour-level effects that change outcomes

No explicit "Top 300/500" hard gate was found in the current production engine path.

Direct effects currently present:

1. Surface Elo competition-level weighting and baseline anchoring
- Tournament level changes expected-opponent baseline and K multipliers, which directly changes module probabilities.
- Source: [artifacts/api-server/src/services/predictionEngine/surfaceElo.ts](artifacts/api-server/src/services/predictionEngine/surfaceElo.ts#L73)

2. Recent Form competition-level weighting and tour-level credibility shrink
- Challenger/ITF-heavy windows are shrunk toward neutral.
- Source: [artifacts/api-server/src/services/predictionEngine/recentForm.ts](artifacts/api-server/src/services/predictionEngine/recentForm.ts#L32)

3. Upset Risk volatility by tournament level
- Adds risk points for certain levels when margin is clear.
- This can indirectly affect recommendation tier and Elite eligibility.
- Source: [artifacts/api-server/src/services/predictionEngine/upsetRisk.ts](artifacts/api-server/src/services/predictionEngine/upsetRisk.ts#L106)

4. Tour reliability discount (ATP) when no specialist and no fitted calibration
- Shrinks probability toward 50.
- Source: [artifacts/api-server/src/services/predictionEngine/dataQuality.ts](artifacts/api-server/src/services/predictionEngine/dataQuality.ts#L202), [artifacts/api-server/src/services/predictionEngine/index.ts](artifacts/api-server/src/services/predictionEngine/index.ts#L554)

5. Specialist eligibility scope
- Only ATP/WTA segments are specialist candidates.
- Challenger/ITF routes stay on general model and lose a path that can support Elite.
- Source: [artifacts/api-server/src/services/predictionEngine/segments.ts](artifacts/api-server/src/services/predictionEngine/segments.ts#L8)

### Candidate designs (read-only)

Candidate A (current): keep current behavior.
- Complexity: none.
- Risk: preserves current cross-interface divergence and level-driven indirect gating.

Candidate B: remove direct ranking/level caps while keeping ranking-level information only as model features.
- Complexity: medium.
- Risk: possible calibration drift; requires walk-forward/shadow validation.

Candidate C: move reliability/tour penalties to recommendation/Elite eligibility only, not probability.
- Complexity: medium-high.
- Risk: historical metric comparability changes; requires migration labels/versioning.

Candidate D: keep a small probability adjustment only when validated by fresh walk-forward evidence.
- Complexity: high (requires controlled ablation/retune loop).
- Risk: lowest scientific risk if done with strict holdout governance.

## 13) Proposed fixes requiring approval

1. Unify pre-match snapshot service across Live Search and Paper Trading
- Build one canonical "predict-from-snapshot" service and feed both paths through it.
- Freeze the same feature snapshot contract (players, histories, weather policy, tournament metadata, calibration version).
- Keep interface-specific UX but remove interface-specific prediction assembly.

2. Add prediction provenance columns to all user-visible rows
- Store: input snapshot hash, strategy version, calibration version, fixture id (if present), and snapshot timestamp.
- Show these in admin/debug panel for mismatch triage.

3. Introduce strict parity checks for unstarted fixtures
- For same fixture id and same snapshot timestamp window, assert probability/recommendation parity between Live Search and Paper Trading.
- Fail noisy drift in CI and in runtime audit reports.

4. Version any future ranking/tour reliability redesign
- If moving toward Candidate C/D, launch as a versioned strategy candidate only.
- Do not auto-promote; validate in walk-forward and shadow replay first.

5. Backward-compatible historical policy
- Do not rewrite prior predictions.
- Render old rows using their stored engine fields, with "legacy strategy" badge when strategy version differs.

## 14) Explicit confirmations

Confirmed for this Phase 10-14 completion work:

- Historical prediction records were not rewritten.
- Production configuration was not auto-promoted.
- Prediction weights and calibration were not changed.
- No investigation-only recommendation was implemented without approval.

## Notes on evidence limits

This report was completed from code-path and stored artifact inspection in read-only mode. It does not include fresh runtime DB query extracts executed in this pass.