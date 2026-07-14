# Task #73 — Historical match time fix: recompute verification

## What changed
`historicalData/backfill.ts`'s `toScheduledStart` previously built
`${fixture.date}T${fixture.time}:00.000Z`, treating the provider's real LOCAL venue wall-clock
time as if it were already UTC. It now reuses the same `resolveTournamentTimezone` +
`combineDateTimeUtc` primitives the live-fixtures path already uses. When the venue's timezone
can't be confidently resolved, it falls back to the fixture's date at UTC midnight with a new,
persisted `scheduledStartTimeConfirmed = false` flag — a documented, flagged fallback, never a
silent guess.

A `recompute` option (`BackfillOptions.recompute`, `--recompute` on the CLI script
`backfillHistoricalMatches.ts`) was added so already-imported fixtures can be purged (match row +
feature snapshots + any `historical_test` evaluation_predictions referencing them) and rebuilt
fresh through the same corrected path, instead of being skipped as duplicates.

## Recompute of the existing corpus
All 18,640 existing `historical_matches` rows (2025-01-01..2025-04-01) were rebuilt from real
provider data with the corrected timezone conversion:
- `matchesInserted: 18640`, `featureRowsInserted: 142460`
- 1,848 rows got a confirmed real local time (`scheduledStartTimeConfirmed = true`); 16,792 fell
  back to date-only UTC midnight with the flag set to `false` (their tournaments aren't in the
  current venue-timezone table — tracked separately by tasks #74/#104, out of this task's scope).

## Walk-forward evaluation before vs. after (real DB, `POST /evaluation/walk-forward/run`)

| fold | before test_acc (n) | after test_acc (n) |
|---|---|---|
| 0 | 53.4 (995) | 54.6 (983) |
| 1 | 52.7 (1027) | 54.6 (1054) |
| 2 | 55.2 (945) | 59.3 (943) |
| 3 | 55.9 (1114) | 60.1 (1131) |

Fold boundaries and per-fold sample sizes shifted only slightly (a handful of matches moved across
a fold boundary near midnight once their real local time was applied) — consistent with a
timezone correction, not a wholesale reshuffle. Re-running the evaluation twice after the fix
reproduced identical fold metrics both times, confirming the corrected pipeline is deterministic.

All `leakage.test.ts` invariants (no-look-ahead, cutoff ordering, matchesPlayed leak/gap check,
etc.) pass against the recomputed store.
