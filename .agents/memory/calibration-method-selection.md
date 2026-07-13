---
name: Calibration method selection (isotonic vs Platt)
description: How the calibration refit chooses between binned-isotonic and Platt/sigmoid fitting, and why both are stored as the same knot representation.
---

The refit (`fitBestCalibration` in `services/evaluation/calibration.ts`) carves a genuinely
held-out slice (20% or a fixed minimum count, whichever is larger, split by predicted-probability
rank so it isn't chronologically biased) out of validation data *before* any fitting happens. Both
the binned-isotonic curve and a Platt/sigmoid curve are fit only on the remaining slice, then
compared on the untouched holdout via log loss. Whichever generalizes better is activated; both
holdout scores plus the chosen method are persisted on the `calibration_models` row.

**Why:** raw per-point isotonic fitting was jaggy at ~4k validation samples, and there was no way
to know if a parametric (Platt) fit would generalize better without contaminating the comparison
with data either method had already seen.

**How to apply:** the winning method's curve is sampled onto a plain `CalibrationKnot[]` grid
(even when Platt wins) so `applyCalibration` and every downstream consumer (specialist segments,
live engine, dashboard) needs zero method-aware branching. If you touch calibration fitting again,
preserve this: never let a second method leak into the codebase as a distinct data shape.
