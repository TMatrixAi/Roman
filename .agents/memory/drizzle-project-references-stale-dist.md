---
name: Stale dist declarations under TypeScript project references
description: Editing a referenced workspace package's schema (e.g. lib/db) doesn't get picked up by a dependent's `tsc --noEmit` until the referenced project's dist/*.d.ts is rebuilt.
---

Packages like `lib/db` use TS project references (`composite: true`, `emitDeclarationOnly: true`,
output to `dist/`). Even though the package's `exports` field points at `./src/...ts` (so runtime/
`tsx` always sees fresh source), a dependent package's plain `tsc -p tsconfig.json --noEmit` run
can still silently type-check against the *old* `dist/*.d.ts` declarations for referenced projects
-- new/changed fields (e.g. a newly added schema column) won't show up as expected, and stale
fields may still type-check as if the old shape were current.

**Why:** non-`-b` `tsc --noEmit` doesn't rebuild referenced composite projects; it just reads
whatever declaration output already exists on disk.

**How to apply:** after editing a referenced package's schema/types (e.g. `lib/db/src/schema/*`),
before trusting a dependent's typecheck result, rebuild the referenced project's declarations
first: `cd lib/db && npx tsc -b tsconfig.json` (and clear stale `.tsbuildinfo` files if the rebuild
seems to no-op). Only then re-run the dependent's `pnpm run typecheck`.

Related: drizzle's own inferred insert type (`typeof someTable.$inferInsert`) types `jsonb` columns
as `unknown`, which is NOT assignable to the recursive `Json` type that `drizzle-zod`'s
`z.infer<createInsertSchema(...)>` produces for the same column. Don't mix the two inferred types
for the same table in the same file (e.g. one helper typed against `$inferInsert`, another against
the zod-inferred type) -- pick one insert-type source per table and use it consistently, especially
in test fixtures that get spread/merged before being passed to a function expecting the other.
