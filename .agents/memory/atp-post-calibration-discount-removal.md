---
name: ATP post-calibration discount removal
description: Why the ATP ×0.63 reliability discount is skipped when real isotonic calibration is active, and what evidence drove the change.
---

## The rule
`TOUR_RELIABILITY_DISCOUNT["ATP"] = 0.63` is skipped in `predictionEngine/index.ts` when `usingRealCalibration` is true (i.e. `input.activeCalibration?.length > 0` and `!generalEnsembleExcluded`).

`LOW_SURFACE_SAMPLE_DISCOUNT = 0.75` still applies even when real calibration is active (it guards per-match data sparsity, not systematic accuracy bias).

## Why
The isotonic calibration in `calibration_models` is fitted on **raw_probability → actual_outcome** for all tours combined. Its knots already bake in ATP's lower observed accuracy (e.g. raw=0.617 → y=0.818 correctly reflects the pooled corpus accuracy at that confidence level). Applying the ATP discount on top of a correctly-fitted calibration is a **double-correction**:

1. Calibration maps raw 0.617 → 0.818 (correct)
2. ATP discount: `50 + (81.8 - 50) × 0.63 = 70.0%` — now understated
3. Actual paper-trade win rate in the 60-70% stated bucket: **80.8%** (n=73)

Paper-trade data (n=520 graded rows, 2026-07-21) confirmed 17-pt underconfidence in the MED-HIGH tier and 26-pt in the HIGH tier when the discount fired.

## How to apply
- `usingRealCalibration` flag is computed just before the discount block in `index.ts`
- If the active calibration is ever cleared (e.g. a fresh environment with no walk-forward run), the fallback path (`calibrateProbability`) runs AND the ATP discount re-applies — which is correct, since the discount was originally sized for the fallback era
- Re-validate once a full 4-fold walk-forward completes with the new code: compare logLoss before/after; if ATP accuracy gap has reversed (ATP now outperforms pooled), add ATP back with an updated factor
- The discount entry in `TOUR_RELIABILITY_DISCOUNT` is preserved for the fallback path and future reference

## Key evidence
- Active calibration knots (id=82, isotonic, n=23023, fitted 2026-07-18): raw=0.570→0.723, raw=0.617→0.818, raw=0.670→0.887
- Paper-trade calibration gap: HIGH (70%+) +26pts, MED-HIGH (60-70%) +17pts, MEDIUM (55-60%) +6pts
- 220 invariant tests pass with the change
