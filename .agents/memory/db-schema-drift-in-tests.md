---
name: DB schema drift surfaces as unrelated test failures
description: A test suite failing with "column ... does not exist" often means the live dev database hasn't caught up to schema.ts, not a bug in the code you just wrote.
---

Drizzle schema files (`lib/db/src/schema/*.ts`) are the source of truth, but the dev database
only picks up new/changed columns when `drizzle-kit push` (via `pnpm run push` in `lib/db`) is
actually run. Multiple concurrent task-agents can add schema fields without ever running push
against the shared dev DB, so a column can exist in `schema.ts` and in generated types for a long
time before the real table has it.

**Why:** the failure mode looks exactly like a regression in the feature you're touching (a raw
pg error like `column "x" does not exist` from deep inside a drizzle insert), even when your own
diff never touched that column or table.

**How to apply:** before debugging application logic, run `pnpm run push` in `lib/db` (or check
`information_schema.columns` for the missing column) to rule out drift. `drizzle-kit push` will
refuse interactively if a new column is `NOT NULL` without a default and existing rows would
violate it — in that case, backfill the column with a real derived value via SQL first (not a
placeholder constant), then set it `NOT NULL`, then re-run push.
