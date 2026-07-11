---
name: Probability calibration fallback shrink curve
description: Why the dataQuality-based fallback shrink formula uses (dataQuality-20)/45 with a 0.4 floor instead of dataQuality/90, and how it relates to the real isotonic calibration model.
---

`predictionEngine/calibration.ts`'s `calibrateProbability` is a fallback ONLY used before/without an
active walk-forward-fitted isotonic calibration model (`evaluation/calibration.ts`, applied in
`predictionEngine/index.ts`). A recurring `job:calibration-refit` job (mirrors
`job:paper-trading`'s pattern -- standalone entrypoint, retries, `job_runs` row per attempt) now
keeps that real model fresh, so the fallback should matter less over time, but must still be sane
for cold starts / gaps.

**Why the curve changed from `dataQuality/90` (floor 0.35) to `(dataQuality-20)/45` (floor 0.4):**
a real walk-forward evaluation over ~18.6k verified 2025 matches showed (a) genuine predictive
signal (pooled test accuracy 54.6-59%, log loss 0.667-0.713 vs. 0.693 baseline) even in a
mostly-low-information ITF/Challenger population, and (b) the fitted isotonic mapping was close to
identity for raw probabilities in the 40-60% band, only needing sharp correction at the extremes
(>85%/<15%). The old `/90` divisor required near-perfect Data Quality for full trust, which never
happens in practice because Data Quality is an unweighted average across modules including
Head-to-Head (near-zero for most matchups) even though H2H is already down-weighted to ~0 influence
on the raw ensemble edge itself (see `buildEnsemble`) -- so most real predictions sat in "Acceptable"
territory (48-63) and got compressed by 0.53-0.70 for reasons the evidence didn't support.

**How to apply:** if Data Quality's own computation changes (a separate, explicitly out-of-scope
concern for this decision), re-validate whether this curve's thresholds (full trust at DQ=65,
floor 0.4 below ~29) still make sense against fresh walk-forward evidence rather than assuming they
transfer. Don't restore a near-DQ=90-for-full-trust curve without new evidence justifying it.
