# Phase 3 Report — Leak-Proof Historical Data Architecture

Date: 2026-07-11
Scope: durable historical match store, pre-match feature snapshots, backfill pipeline,
automated leakage tests, and an honest accounting of real vs. structurally-supported-but-empty
data, per the Phase 3 task boundaries.

## 1. Schema

Two new, append-only Postgres tables (`lib/db/src/schema/historicalMatches.ts`), pushed to the
dev database:

- `historical_matches` — one immutable row per completed/retired/walkover/cancelled match:
  tour, tournament name/level, surface, round, format, both players, result/score,
  retirement/walkover/cancellation flags, `scheduledStartAt`, the `cutoffMinutes` config used,
  and the resulting `cutoffAt` (frozen at import time so a later config change can never
  reinterpret an old row), plus the raw provider payload for audit.
- `match_feature_snapshots` — one immutable row per (match, player, feature): `featureValue`,
  `sourceTimestamp` (when the underlying fact existed), `matchCutoffAt` (denormalized from the
  match), and `existedBeforeCutoff` (computed once, at write time, never recalculated).

## 2. Configurable cutoff

`services/historicalData/types.ts` defines the required options — 24h / 12h / 6h / 1h / 30min /
15min before scheduled start — defaulting to **30min**. The cutoff used for a given backfill run
is frozen onto every match row it produces (`cutoffMinutes`, `cutoffAt`), so mixing runs with
different cutoffs in the same table is fully auditable, not silently inconsistent.

## 3. Real coverage investigation (verified live, 2026-07-11)

`get_fixtures` accepts a plain `date_start`/`date_stop` window with **no `player_key`**, and
returns every match across all tours/levels in that window — this is the mechanism the backfill
uses, since it gives tour-wide chronological coverage rather than requiring a pre-known seed
list of players.

Findings from direct live probing:
- Real match data exists back to at least **2010** (spot-checked; a 2005 window returned no
  matches, a 2010 window did).
- Windows up to ~3 weeks return successfully; a 2-week window during the current (busy,
  mid-season) period returned **HTTP 500**, and a 1-week window returned a **~30MB** JSON
  payload. The pipeline therefore chunks requests into **5-day windows by default**
  (`chunkDays`, overridable) — this is a provider-side stability constraint discovered during
  this phase, not an arbitrary choice.
- No bulk "all history for one player" endpoint exists beyond the existing per-player
  `get_fixtures?player_key=`, so a full multi-year backfill would need to run as many
  sequential 5-day chunks — feasible, but a genuinely large historical pull (e.g. 2015-2025)
  was not run in this phase; see §6.

## 4. What was actually imported this phase

Real backfill covering `2026-06-28` → `2026-07-10` (13 days, cutoff = 30min default), run as
two separate, non-overlapping process invocations (`06-28`→`07-04`, then `07-05`→`07-10`) to
deliberately exercise and verify cross-run continuity (§5):

| Metric | Value |
|---|---|
| Matches imported | **4,103** |
| Distinct players involved | 3,635 |
| Feature snapshot rows written | 18,641 |
| Cancelled matches (no winner) | 67 |
| Retired matches | 117 |
| Fixtures fetched but excluded (no terminal result) | 1 |
| Duplicates on a re-run over an already-imported window | 2,093 (correctly skipped, zero new inserts — see §6) |

By tour:

| Tour | Matches |
|---|---|
| ITF | 2,551 |
| Challenger | 878 |
| Junior | 234 |
| ATP | 195 |
| WTA | 193 |
| Mixed Doubles | 31 |
| Teams Women | 12 |
| Teams Men | 9 |

By surface: **Grass — 651**, **Unknown — 3,452**. This mirrors the exact surface-lookup gap
already documented in `docs/audit-phase2.md` §4/§6: only marquee tournaments (in this window,
Wimbledon plus a handful of grass tour events) resolve to a real surface; the large majority of
day-to-day Challenger/ITF/Junior volume has no surface label, so those matches structurally
cannot get an `eloSurface` feature (620 `eloSurface` rows exist, vs. 4,512 `eloOverall` rows).

This window was chosen deliberately small (13 days, ~4K matches) to keep the first real
pipeline run fast to verify end-to-end and cheap to leakage-test, per this phase's explicit
license to "produce a smaller real dataset than the original ambition describes." The pipeline
itself has no size limit — running it repeatedly over earlier date ranges (back to ~2010, in
5-day chunks) is how a much larger corpus would be built; that full backfill was not run in this
phase (see §6).

## 5. Cross-run continuity (fixed during review)

An initial version of the pipeline kept player state (Elo, recent form) only in the current
process's memory. That is correct for a single invocation but wrong for real operation, where
the backfill is run repeatedly over new date ranges as separate process invocations: a later
run would have cold-started every player's history at zero instead of continuing from what was
already stored, silently corrupting every feature for the first matches of each new run.

Fixed by hydrating each run's in-memory state from the database before processing: any match
already stored with `scheduled_start_at` before the run's window is replayed (in the same
chronological order it originally happened) to rebuild Elo/form/recent-history state, using a
new `game_margins_player1` column (structured, not re-parsed from the raw provider payload) so
replay doesn't depend on provider-specific raw shapes. Matches encountered mid-run that already
exist (duplicates from an overlapping re-run) are also folded into state rather than silently
skipped, so state stays correct even when overlapping.

Verified live: wiped the store, ran the backfill as **two separate process invocations**
(`2026-06-28`→`07-04`, then `2026-07-05`→`07-10`, no overlap), then re-ran the leakage suite —
all checks pass, including the exact-count `matchesPlayed` check across the full store
(which would fail if the second process had cold-started any continuing player). A dedicated
test also confirms the store contains non-zero `matchesPlayed` values proving state actually
carried over between the two runs, not just within one.

**Atomicity**: a match row and all of its feature snapshots are now written in a single DB
transaction, so a process crash between the two writes can never leave an orphaned match with
missing snapshots. As defense in depth against pre-existing bad data (or external tampering),
the duplicate-detection path also recomputes -- using the exact same `computeFeatures()` call
and cutoff filter the insert path uses, against the identical running state a chronological
replay guarantees -- exactly how many feature rows a stored match *should* have, and fails the
whole run loudly if the persisted count doesn't match. A dedicated test injects a genuine orphan
(a match with real prior player history but zero snapshots) and confirms the backfill refuses to
proceed past it, while confirming legitimate debutant matches (players with no prior history, or
features one exists for) still, correctly, get zero snapshots without tripping the check.

## 6. Leakage tests

`artifacts/api-server/src/services/historicalData/leakage.test.ts` (`pnpm --filter
@workspace/api-server run test:leakage`), run against the real imported data above — **8/8
passing**:

1. No feature snapshot has `sourceTimestamp >= matchCutoffAt`.
2. No feature snapshot has `existedBeforeCutoff = false`.
3. No feature snapshot's denormalized `matchCutoffAt` disagrees with its match's `cutoffAt`.
4. No match is stored more than once (`provider` + `externalId` unique).
5. `cutoffAt` is always strictly before `scheduledStartAt` for every match.
6. No feature snapshot is sourced from its own match's start time or later.
7. **Strongest check**: each player's `matchesPlayed` feature value exactly equals a live
   count of that player's own strictly-earlier terminal matches — this catches both leakage
   (an inflated count including this match or a later one) and gaps (a deflated count from a
   skipped earlier match) in one assertion.

Idempotency was also verified live: re-running the backfill over an already-imported window
(`2026-06-28`→`2026-07-04`) inserted **zero** new matches and skipped all 2,093 as duplicates.

## 7. Field-by-field: real vs. structurally-supported-but-empty

| Field | Status | Notes |
|---|---|---|
| Match identity, date/time, players, format, round | **Real** | Direct from `get_fixtures` |
| Result, score, retirement/walkover/cancellation | **Real** | Same source as Phase 1/2 |
| Tour (ATP/WTA/Challenger/ITF/Junior/...) | **Real** | Derived from `event_type_type`, verified against `get_events` in Phase 2 |
| Surface, tournament level | **Real for ~40 marquee tournaments; `null` otherwise** | Same static-lookup gap as Phase 2; see §4 above for this window's actual ratio |
| `matchesPlayed`, `winPctLast10` (recent form) | **Real, derived** | Computed strictly from this store's own earlier matches |
| `eloOverall`, `eloSurface` | **Real, derived** | Standard incremental Elo (K=32, start 1500) computed in strict chronological order; `eloSurface` only populated when a surface label exists |
| `gameShareLast10` (serve/return proxy) | **Real, derived proxy** | Same game-margin proxy approach as the live `serveReturn` engine module (Phase 1/2), not point-level stats |
| Ranking-at-match-time | **Structurally supported, not populated** | Schema has no field for this; API-Tennis's standings endpoint only exposes the *current* snapshot, not historical rank-on-a-date — adding it would require either a provider with historical rankings or accepting today's rank as a (leaky) proxy, which we explicitly do not do |
| Point-level serve/return stats (aces, first-serve%, etc.) | **Unavailable from this provider** | Confirmed absent in Phase 2; not attempted here |
| Fatigue beyond days-since-last-match | **Partially real** | `matchesPlayed`/history gives days-since-last-match implicitly via `sourceTimestamp`; travel/altitude/injury-load fatigue is not modeled |
| Injury/availability | **Unavailable** | No provider field exists; not fabricated |
| Weather/court-speed for historical matches | **Not attempted** | Out of scope per the task; would need Open-Meteo + a venue/location lookup per historical tournament, which doesn't exist yet |

## 8. Explicitly out of scope, confirmed still out of scope

Per the task's boundaries: no ML training happened against this data, no point-by-point data
was pursued (not available from this provider), no historical weather backfill was attempted,
and no new paid API integration was added or proposed — API-Tennis's real, live-verified
coverage was sufficient to build a correct, leak-proof foundation for this phase's date range.
A larger historical pull (multi-year) is a pure volume/time question for a future phase, not a
capability gap — see the recommended follow-up.
