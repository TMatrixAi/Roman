---
name: Historical backfill cross-run state continuity
description: A chronological backfill pipeline that keeps running feature state (Elo, form) only in process memory will silently corrupt data once run more than once as separate invocations.
---

Any pipeline that computes running per-entity state (Elo ratings, rolling form, streaks, ...)
while importing historical records in chronological order must **hydrate that state from
already-persisted records before processing a new run**, not just carry it in the current
process's memory.

**Why:** in-memory-only state is correct for a single invocation, but real operation runs the
importer repeatedly over new date ranges as separate process invocations (e.g. a daily/weekly
backfill cron). Without hydration, every new run cold-starts every continuing entity's state at
its baseline, silently corrupting the first records of every run after the first — a bug that
unit tests scoped to a single run cannot catch.

**How to apply:** before processing a new window, replay all persisted prior records (strictly
before the window, in original chronological order) through the exact same state-update
function used for live processing, and also fold in any mid-run duplicates encountered (from
overlapping re-runs) rather than silently skipping them. To verify: wipe the store, run the
importer as two separate process invocations over adjacent non-overlapping windows, then check
that entities continuing from run 1 into run 2 show correct cumulative counts/state in run 2 —
a single-process test run will not expose this bug even if it "passes".

**Related atomicity pitfall:** a parent record and its derived computed rows (e.g. a match row
and its feature snapshots) must be written in one DB transaction, not two sequential inserts —
otherwise a crash between them creates an orphan that idempotency logic will treat as "already
imported" forever, permanently losing the derived data with no repair path. When adding a
defense-in-depth check that a stored record has the derived rows it should, recompute the exact
expected value using the same function the insert path uses (not a heuristic like "count > 0")
— fields can legitimately be empty for a subset of records (e.g. a true debutant with no prior
history), and a heuristic check will false-positive on those.
