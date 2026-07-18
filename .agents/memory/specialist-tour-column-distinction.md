---
name: Specialist tour vs tournament_level column
description: historical_matches has two distinct tour columns; specialist SQL must use the right one.
---

# Specialist segment SQL — `tour` vs `tournament_level` column

## The rule
`historical_matches` has **two separate columns**:

- `tour` — generic label: `'ATP'`, `'WTA'`, `'ITF'`, `'Challenger'`, `'Junior'`, etc.
- `tournament_level` — specific tier: `'ATP250'`, `'Masters1000'`, `'WTA250'`, etc.

All specialist segment SQL (`computeOneSegment` in `specialistWeights.ts`) must filter by
`eq(historicalMatchesTable.tour, segment.tour)` — i.e. `tour = 'ATP'` — **not**
`inArray(historicalMatchesTable.tour, ['ATP250','Masters1000'])` which queries the wrong column
and returns zero rows.

**Why:** Using `inArray` with tournament_level values against the `tour` column looks plausible
but silently returns 0 rows, causing every specialist to show `n=0` and `meets_threshold=false`.
The failure produces no error and no warning — only the empty `specialist_models` table gives it
away.

## How to apply
- When writing any drizzle query that filters by tour/circuit for specialists, use
  `eq(historicalMatchesTable.tour, 'ATP')` (or `'WTA'`, etc.).
- `tournament_level` is the right column to use when you need ATP250/Masters1000-level specificity
  for analytics queries that **don't** go through the specialist segment pipeline.
- `resolveSegment()` in `segments.ts` accepts both forms as input (it normalises 'ATP250' → 'ATP'
  via `TOUR_LEVEL_TO_GROUP`), but the DB column it queries is always `tour`.

## Data counts (as of 2026-07-18, after Task #44 backfill)
- ATP (tour='ATP'): ~9,567 historical matches
- WTA (tour='WTA'): ~9,115 historical matches
- Without Task #44's backfill, both counts were 0, so specialists couldn't qualify.
