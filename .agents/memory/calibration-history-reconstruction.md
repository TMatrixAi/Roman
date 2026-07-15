---
name: Calibration history reconstruction for point-in-time replay
description: How to resolve "which calibration mapping was really active on date X" instead of applying today's active mapping uniformly.
---

`calibration_models` (and any similarly-designed "currently active artifact" table) is never
deleted-and-replaced -- a refit flips the old row's `active` to false and inserts a new
`active: true` row with a fresh `fittedAt`. That means the table's own rows already ARE a durable
timeline: entry N was genuinely in force from its own `fittedAt` until entry N+1's `fittedAt`
superseded it.

To honestly replay/grade a historical row as of its own timestamp `T` (e.g. a match's `cutoffAt`),
load the whole history once (ordered by `fittedAt`), then binary-search for the LATEST entry whose
`fittedAt <= T`. Return null/absent if `T` predates the first fitted entry -- never backfill with a
later mapping that didn't exist yet at that point in real history.

**Why:** applying "today's active mapping" uniformly across a replayed date range makes the result
describe "what today's model would say about the past," not "what would genuinely have been
produced back then" -- a materially different and less honest claim for evidence that's meant to
simulate live paper trading.

**How to apply:** any point-in-time replay/backtest that reuses a mutable "currently active"
artifact (calibration, specialist weights, feature flags, etc.) should resolve it per-row from the
artifact's own fit-history table, not fetch the single current value once for the whole run --
unless the artifact's own semantics make that circular (e.g. a walk-forward fold's OWN fitted
mapping must never be applied back to that same fold's rows).
