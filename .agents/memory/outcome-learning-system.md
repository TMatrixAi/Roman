---
name: Outcome-learning system design
description: Architecture of Task #12 — evaluationOnly walk-forward, optimizer, pattern analysis, threshold evaluation, and their invariants.
---

## Key design decisions

**evaluationOnly walk-forward** (`walkForward.ts`):
- When `evaluationOnly=true`, loads the active calibration from DB before the fold loop, uses it frozen for all folds, and skips `calibrationModelsTable` writes and `computeAndStoreSpecialistSegments`.
- The "Run Walk-Forward" dashboard button sends `evaluationOnly: true` (default, safe).
- Training mode (`evaluationOnly=false`) is only triggered by the optimizer endpoint.

**Optimizer** (`candidateOptimizer.ts`):
- Calls `runWalkForwardEvaluation({ evaluationOnly: false })` — this DOES refit calibration + specialist weights.
- Always INSERTs a new `candidate_configs` row; never updates the active calibration directly.
- Also calls `runThresholdEvaluation()` after every optimizer run.

**Pattern analysis** (`patternAnalysis.ts`):
- Runs automatically after every walk-forward (both modes) via lazy import at the end of the fold loop.
- Excludes: validation-segment rows (used to fit calibration), `paper_trade_shadow` rows (simulated), `pending`/`void` rows.
- Segments: surface, tournamentLevel, probabilityBand, upsetRiskTier, modelAgreement, closeMatch, dataQualityTier, runKind.
- Evidence strength: Strong (n≥100, CI<12%), Moderate (n≥30), Weak (n≥10), Insufficient (<10).

**Threshold evaluation** (`thresholdEvaluation.ts`):
- No-widen rule: a widening candidate (lower DQ floor, wider close-match band) that doesn't improve holdout log loss is always Reject.
- Tier dimensions scored: eliteDQFloor (current=55), closeMatchBand (current=3), upsetRiskGate, agreementGate, confidenceFloor.
- Minimum sample for reliable comparison: n≥30 for the candidate cohort.

**DB tables added** (in `lib/db/src/schema/evaluation.ts`):
- `pattern_analysis_runs` — JSONB segments array + totalAnalyzed + runKindsIncluded
- `threshold_evaluation_runs` — JSONB thresholds array + totalGraded

## Walk-forward loading performance
Walk-forward always loads ALL historical_matches to build Elo/form/identity indices — this is the slow part (8-12+ min with production corpus). Tests that call the full walk-forward must expect this. Fast tests should use the early-return path or verify at source-code level.

## ESM test file gotcha
`__dirname` is not available in ESM (`.ts` files run via tsx). Use:
```typescript
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
```

## Invariant tests (outcomelearning.test.ts)
- Tests 1-2: source-code structural checks (fast, no DB writes needed).
- Test 2: early-return path with `warmupFraction=0.9999` confirms evaluationOnly propagates through both return paths.
- Tests 3-4: DB-level tests with synthetic inserted rows (fast, ~200ms each).
- Test 5: pure unit test re-asserting tieBreakers cascade guard.
- Test 6: DB schema accessibility smoke test.

**Why:** Walk-forward integration tests (running full corpus) can't run within a 5-min shell timeout. Code-structure + early-return tests give meaningful coverage without the time cost.
