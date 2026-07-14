---
name: Data richness vs. matchup difficulty conflation
description: Sample-count/history-depth-based reliability signals can't measure "how hard is this specific matchup," and confuse the two in ways that break calibration at the top of the trust scale.
---

Reliability/confidence formulas built from "how much logged history exists for this input" (sample
counts, resolved-signal ratios) climb and saturate as more data accumulates -- but that saturation
correlates with WHO gets logged extensively, not with how easy the resulting prediction is. In a
tennis prediction engine, players/matchups with deep logged histories skew heavily toward
tour-level, deeper-draw contests between comparable professionals -- which are intrinsically harder
to call correctly than lopsided lower-tier mismatches, not easier. A blend/confidence score built
only from sample-richness proxies therefore rewards (with higher trust) exactly the population where
real accuracy is structurally worse, producing a monotonic *reversal* above some trust threshold
instead of the intended monotonic improvement.

**Why:** validated via a 4,111-row out-of-sample walk-forward audit — decile analysis of each
sample-count-based module's own directional accuracy against its own reliability showed no clean
monotonic/threshold pattern (oscillates ~51-63% across the full range), ruling out "one module's
formula is simply miscalibrated." The effect is a population-selection artifact, not a per-module
math bug, and a genuinely different "quality of competition" signal (e.g. ranking parity) would be
needed to fully separate the two properties — diluting/reweighting existing richness-based modules
can shrink the affected population but can't fully correct it.

**How to apply:** before trusting a rising confidence/DQ/reliability score as "this prediction is
more trustworthy," check whether the score's inputs are proxies for how much data exists rather than
how correct the underlying model is on that specific case. If they are, validate the top of the
score's range against real outcomes specifically — don't assume higher input volume implies higher
accuracy without checking, especially in domains where more-documented cases are systematically
different (harder or easier) than less-documented ones.
