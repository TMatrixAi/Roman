---
name: Data Quality threshold calibration reversal (post H2H-exclusion)
description: Real walk-forward evidence that high Data Quality no longer means more trustworthy post-#68; use before touching any DQ-gated threshold in predictionEngine.
---

After a fix that excludes Head-to-Head from the numeric Data Quality (DQ) blend (raising most real
DQ scores), a full walk-forward re-run + live ledger analysis (n=4,111 graded rows) showed the
DQ-to-accuracy relationship most DQ-gated constants assumed had inverted: calibration is
well-behaved up to DQ~55 (best band is actually 45-55), then gets monotonically *worse* the higher
DQ climbs -- the top band (85-100) was worse-calibrated than a coin flip, and this held even after
isolating DQ from every other gate (all-signals-agree, margin) it's normally bundled with.

**Why:** DQ is an average of per-module *reliability* labels, not a direct accuracy signal. A
change to what's included/excluded in that blend (e.g. dropping a structurally-low-value module)
shifts the whole distribution's meaning -- old thresholds tuned against the pre-change distribution
silently stop matching reality, and can end up rewarding exactly the regime the new distribution
makes least trustworthy.

**How to apply:** Any time `dataQuality.ts`'s module composition changes, re-validate every
consumer that gates on a DQ threshold (`calibration.ts`'s shrink curve, `recommendation.ts`'s
STRONG_RECOMMENDATION/DO_NOT_RECOMMEND gates, `eliteTier.ts`'s `ELITE_DATA_QUALITY_THRESHOLD`) with
a fresh walk-forward run before trusting the old numbers -- don't assume "higher DQ = more
trustworthy" still holds. See `artifacts/api-server/docs/audit-task75-dq-threshold-revalidation.md`
for the full bucketed evidence and the resulting constant changes (thresholds moved from the old
"Strong" floor of 65 down to 55/45, with the shrink curve's trust ceiling also capped below 1.0).
