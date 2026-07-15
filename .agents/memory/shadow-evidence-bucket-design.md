---
name: Shadow/simulated evidence bucket design
description: Pattern for adding a fast, honestly-labeled simulated evidence bucket alongside real live/backtest evaluation buckets without letting it contaminate them.
---

When adding a "simulated" or "shadow" replay bucket to an evaluation/scoring system that already
has real live and backtest evidence buckets:

- Give it its own `runKind` (or equivalent discriminator) value, never mixed into existing
  buckets' aggregates/dashboards. Enforce append-only via a natural unique constraint (e.g.
  `(runKind, matchId)`), so a match already claimed by one run stays claimed forever and a
  re-run over an overlapping range just skips it (first-writer-wins). Only an explicit,
  narrowly-scoped `overwrite` (matched on the exact batch/run label) may delete rows, and it must
  never be able to touch a different bucket's `runKind`.

- If the bucket grades using a currently-active model/calibration artifact (rather than one fit
  from its own held-out data), that is a real methodological compromise, not free correctness --
  document it as an explicit caveat in both code and UI copy, applied uniformly and up front
  once per run rather than re-fetched per row (which would just add noise, not honesty).

**Why:** without a natural append-only constraint plus scoped overwrite, "just re-run it" silently
duplicates or corrupts prior evidence; without a distinct runKind, simulated evidence quietly
inflates real live/backtest track-record numbers.

**How to apply:** any future "replay historical data through the current model" feature (not just
this one) should follow this same shape: distinct discriminator column, natural-key append-only
constraint, label-scoped overwrite, and an honest one-time-per-run caveat about what's simulated.
