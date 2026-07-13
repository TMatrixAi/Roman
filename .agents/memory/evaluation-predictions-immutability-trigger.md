---
name: evaluation_predictions immutability trigger
description: DB-level trigger enforcing settle-once on evaluation_predictions; which columns are exempt and why; how it's applied since this project uses drizzle-kit push (no migration files).
---

A `BEFORE UPDATE` trigger on `evaluation_predictions` (function
`evaluation_predictions_prevent_settled_update`) rejects any change to outcome
columns (status, actual winner, result type, includedInAccuracy, gradedAt,
rawProbability, predictedWinner*, player ids, scheduledStartAt, cutoffAt) once
`status` has left `'pending'` -- a database-level backstop behind the
application-level `WHERE status = 'pending'` guard in
`services/evaluation/settle.ts`.

**Two columns are deliberately exempt, not oversights:** `calibrated_probability`
and `fold_id`. The walk-forward runner (`services/evaluation/walkForward.ts`)
inserts historical_test rows already graded/void, then immediately re-applies
that fold's freshly-fit calibration mapping to its own just-inserted rows
(`recalibrateRows`) and backfills `fold_id` once the owning `evaluation_runs`
row exists. Both are legitimate same-run bookkeeping, not post-hoc outcome
tampering -- a blanket "no update after settle" trigger breaks this real flow
and fails the walk-forward integration test.

**Why:** this project's `lib/db` uses `drizzle-kit push` (no migration files),
and drizzle-orm 0.45.2 has no `pgTrigger` API, so triggers/functions can't live
in `schema.ts` and get pushed automatically.

**How to apply:** raw SQL lives in `lib/db/src/sql/*.sql`; `lib/db/src/applySqlExtras.ts`
applies it against `DATABASE_URL` and is idempotent (safe to re-run every push).
Wired into `push`/`push-force` npm scripts so it runs on every dev push,
including post-merge setup. DELETE is NOT covered by this trigger -- a settled
row can still be deleted; see follow-up task tracking that gap.

**Test-run cost note:** the walk-forward integration test
(`services/evaluation/walkForward.test.ts`) builds match-history/Elo indexes over
the *entire* shared `historical_matches` table, not just its own 40 synthetic
rows -- as that table accumulates real backfilled data over the project's life,
this single test can legitimately take 5-10+ minutes. Don't assume a hang;
budget accordingly (a single `ShellExec` call maxes at 5 min, so route long runs
through `CodeExecution`'s `"use impure"` `child_process.exec` with a longer
`timeout`, not `nohup`/background shell jobs).
