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

**Destructive rebuild + can't finish inside a single shell tool call:** `runWalkForwardEvaluation`
unconditionally deletes the ENTIRE `evaluationRunsTable` and every `historical_test`
`evaluationPredictionsTable` row at the start of every call (a "rebuild the one true evaluation
history from scratch" design, not an accumulating log). Once the corpus grew past ~18k real rows,
a single call legitimately takes 8-12+ minutes end to end (preload + 4 folds), which exceeds a
single ShellExec call's ~300s ceiling. `walkForward.test.ts` calls this same function directly (not
mocked), so running that test now (a) can't complete inside one shell call and gets SIGTERM-killed
mid-run, and (b) even a killed/interrupted attempt still executes the real delete-everything step
at the top, silently wiping any real evaluation history that existed before you ran the test.
**How to apply:** never re-run `walkForward.test.ts` (or call the walk-forward endpoint) casually
to "just check it still passes/works" -- both destroy the current production evaluation history on
every invocation. To validate engine changes, prefer the fast focused unit tests instead
(serveReturn/dataQuality/calibration/etc., each <2s). If you must exercise a fresh walk-forward run
for real reporting, trigger it via HTTP against the already-running workflow (background trigger +
poll `GET /evaluation/runs`, per the sandbox-background-process-limits note) and only do it once
you're ready to accept the old history being replaced.

**HTTP-trigger workaround is not reliable either:** in one session the API-server workflow itself
kept dying/restarting every ~10-20s for reasons unrelated to the walk-forward call (no crash/error
in logs -- it just stopped), so a backgrounded HTTP trigger never got far enough to matter. A direct
`pnpm exec tsx <script calling runWalkForwardEvaluation()>` run in the foreground (no server, no
build step) got further per attempt, but each per-fold pass still took ~2-3 min and grew slower
each successive fold (larger training-history rebuild), so even this couldn't fit a full 4-fold run
in one ~295s shell call, and every re-invocation re-triggers the destructive delete-everything step
at the top -- so a partial/interrupted run leaves only the folds that finished, not a resumable
checkpoint. Budget a session with real multi-call headroom (or get workflow stability fixed first)
before attempting a full re-run; don't expect to finish one opportunistically alongside other work.

**Full-corpus preload now reliably OOMs outright at current data scale, and raising the Node heap
does not help:** by 2026-07 the corpus reached ~133K `historical_matches` / ~229K per-feature
`match_feature_snapshots` rows, and a single full preload (`buildMatchHistoryIndex` +
`buildEloHistoryIndex` + `buildPlayerIdentityIndex`) now crashes with "JavaScript heap out of
memory" consistently around 30-40s in -- confirmed identically via the pre-existing walk-forward
endpoint AND a brand-new feature (shadow-mode replay) that reuses the same preload helpers, so this
is a shared, environment-scale ceiling, not a bug in whichever feature happens to trigger it.
Passing `NODE_OPTIONS=--max-old-space-size=<bigger>` does NOT fix this in this sandbox -- the crash
recurs at the same ~2040MB heap size regardless of the flag, and `free -h` shows only ~2.7-3.3GB
actually available system-wide (7.8GB total RAM, 2 CPUs, shared with other running dev workflows +
several `tsserver` processes) -- consistent with a container-level memory ceiling below what the
requested V8 heap size would need, not a V8-side self-imposed limit. Don't waste a session trying
larger heap flags once you've confirmed the crash point doesn't move; that's the signal it's a
system RAM ceiling, not a V8 configuration issue.

**How to apply:** any new feature that reuses these same full-corpus preload helpers (not just
walk-forward) will hit this identical ceiling in this sandbox at current data scale -- treat it as
a known, pre-existing environmental limitation to note/caveat, not something to chase fixing as
part of an unrelated feature's scope. Fixing it for real needs a different approach entirely
(streaming/paginated index construction, a background worker with its own memory budget, or
narrower per-player history queries) -- see the dedicated follow-up task for this if one exists
before starting from scratch.
