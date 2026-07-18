---
name: Contradiction scan calibration findings
description: Key findings from Task #32 Phase 3 contradiction scan on n=2422 graded predictions; calibration and historical-data warnings.
---

## Summary (2026-07-18, n=2422 graded predictions)

### Global underconfidence
ALL DQ bands show positive calibration gap (accuracy > stated winner probability):
- DQ 0-24: +42pt gap (97.1% vs 55.0% stated) — DO_NOT_RECOMMEND, still picks correctly
- DQ 25-44: +33.8pt gap
- DQ 45-54: +21.2pt gap
- DQ 55-64: +16.9pt gap
- DQ 65-84: +19.6pt gap
- DQ 85-100: +9.5pt gap (accuracy 65.3% vs 55.9% stated)

Engine is systematically underconfident. Calibration curve was tuned for overconfidence (when corpus was small); corpus has since grown and the relationship reversed. A walk-forward re-fit is needed.

### Tie-breaker contamination
- 468 graded predictions have tieBreakerApplied=true, accuracy 30.8% (vs 76.9% baseline)
- Historical artifact: most were made with the OLD cascade (removed Task #5, 2026-07-15) which was anti-predictive for close calls
- These rows likely contaminate calibration training data (calibration fits on ALL graded rows)
- Action: filter tieBreakerApplied=true rows created before the cascade-removal date from calibration re-fits

### Elite tier
- n=12 graded rows with isEliteTier=true, accuracy 41.7%
- n=12 is too small — re-check when n≥50

### Model conflict
- n=5 graded rows with modelConflict=true, accuracy 40.0% — too small for conclusions

## What NOT to do
- Do not treat DO_NOT_RECOMMEND accuracy (97.1%) as a bug — low-DQ predictions can still pick the right player with low stated confidence
- Do not re-tune calibration curve from a flat snapshot without walk-forward isolation (look-ahead bias risk)

**Why:** calibration fits need walk-forward isolation; a flat snapshot mixes historical and recent data in ways that make the curve look better or worse than it really is. See walkforward-historical-scoring-perf.md for walk-forward cost/duration notes.
