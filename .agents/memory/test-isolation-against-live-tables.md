---
name: Test isolation against tables real jobs also write to
description: Unit tests that assert exact counts on shared tables (historical_matches, evaluation_predictions) break once real backfills/scheduled jobs populate the same table outside the test.
---

Some unit tests (e.g. `specialistWeights.test.ts`) seed a few synthetic rows into a real,
shared table (`historical_matches`, `evaluation_predictions`) and then assert an EXACT count,
implicitly assuming the table started empty. That assumption silently breaks the first time real
data coexists in the same environment -- a manual backfill, or once a recurring job (like
`job:calibration-refit` / `job:paper-trading`) actually runs on schedule and populates the same
tour+surface segments the test uses.

**Why this matters:** the failure looks like a logic regression (an assertion mismatch on a
specific number) but is actually an environment-state issue -- the production code under test is
correct, only the test's "table starts empty" assumption is wrong. Chasing it as a code bug wastes
time.

**How to apply:** when writing or fixing a test that inserts synthetic rows into a shared
production table and asserts a count on that table, snapshot the real pre-existing count for the
exact key (e.g. `tour+surface`) before inserting, and assert `preexisting + syntheticCount` rather
than a bare literal. This makes the test correct regardless of what real data already exists.
