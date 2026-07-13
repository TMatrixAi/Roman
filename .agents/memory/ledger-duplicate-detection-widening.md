---
name: Ledger duplicate detection widening
description: How the Ledger duplicate-trade detector merges rows by more than one rule, and the test-suite gotcha that comes with adding a time-based rule.
---

The Ledger's duplicate-trade detector (`ledgerDuplicates.ts`) merges rows that match on ANY of
multiple independent rules (exact key: pair+tournament+surface+format; time-proximity: same pair
created within a short window regardless of other fields), using union-find so a group formed by
one rule chains correctly with a group formed by another.

**Why:** real double-submissions change tournament/surface/format between the two rows (e.g.
Predict Now with no tournament, then Custom Match with it filled in), so keying only on an exact
field match under-detects. But merging must stay narrow enough that the same pair meeting again
weeks/months later is never treated as a duplicate.

**How to apply:** when widening any "is this a duplicate" rule to add a new dimension (e.g. time),
re-audit existing negative tests for that rule. A test asserting "different X is never a
duplicate" that doesn't also control for the new dimension will start failing (or worse, silently
begin exercising the wrong path) once real-world timestamps in that test happen to fall inside the
new rule's window. Give negative tests explicit values on every dimension the detector now
considers, not just the one under test.
