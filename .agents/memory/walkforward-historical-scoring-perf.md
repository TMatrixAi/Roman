---
name: Walk-forward historical scoring performance
description: Per-match backtest loops over the full historical corpus must preload data once instead of querying per match, or a naive scorer can look like a hang.
---

Backtest/evaluation code that re-scores the ENTIRE historical match corpus (not a small sample)
must never issue per-match DB queries inside the scoring loop. Preload everything the scorer
needs ONCE up front into an in-memory index (grouped/sorted by whatever key the loop looks up by),
then have the per-match step do pure in-memory lookups.

**Why this matters:** at real corpus scale (tens of thousands of rows), a handful of sequential
DB round-trips per match compounds into tens of thousands of round-trips per run. This doesn't
fail loudly -- it just runs very slowly with near-zero CPU usage and no output, which is easy to
misdiagnose as a genuine deadlock/hang rather than serialized network latency. Making a scoring
step more accurate/expensive per-match (e.g. running a fuller model) is a legitimate, expected
cost; adding avoidable I/O per match on top of that is not.

**How to apply:** before adding a new per-match data dependency to any full-corpus backtest loop,
ask whether it can be loaded once (a single bulk query, held in memory for the run) instead of
looked up inside the loop. If the corpus is small enough to hold entirely in memory, it almost
certainly can be.
