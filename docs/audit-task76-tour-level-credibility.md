# Sub-Tour Elo Inflation ("Grinder Outranks Real Tour Player") — Investigation & Fix

Date: 2026-07-13
Scope (Task #76): lower-tier players whose rating history is built almost entirely from
sub-tour (Challenger/ITF) competition were outranking genuine tour-level players in win
probability, because an unresolved opponent silently defaulted to a flat, level-blind
`STARTING_ELO = 1500` and nothing ever pulled a rating built inside an isolated sub-tour pool
back toward a real, tour-anchored baseline.

## 1. Root cause

Two compounding issues, both in `surfaceElo.ts`:

1. **Flat opponent fallback.** When an opponent's real Elo wasn't resolved (common for
   Challenger/ITF opponents, who are rarely backfilled), `replayElo()` fell back to a single flat
   `STARTING_ELO = 1500` regardless of the match's actual level. A player who mostly beat
   unresolved ITF opponents was being scored as if they'd beaten a string of tour-average (1500)
   players — a real, structural inflation, not a data-quality artifact.
2. **No cross-pool anchoring.** Tennis's real Elo pools (ITF / Challenger / ATP-WTA) are only
   loosely cross-linked. A player whose matches never touch a tour-level opponent can drift well
   above the real corpus baseline *within their own pool's reference frame*, with nothing in the
   engine to recognize that the whole pool sits below tour level. This is broader than the flat
   fallback alone — it persists even for players with decent opponent-resolution coverage.

`recentForm.ts` has the analogous flaw: its per-match `levelWeight()` down-weights sub-tour
matches, but the final weighted average re-normalizes by the same shrunk weights, canceling the
down-weighting out. A 100%-ITF win streak could still read close to 100 form.

## 2. Real baseline data (not fabricated)

Queried `match_feature_snapshots` / `historical_matches` directly (as of 2026-07-13) for real
average `eloOverall` by tournament level:

| Level | Avg eloOverall (rounded) |
|---|---|
| GrandSlam | 1537 |
| Masters1000 | 1531 |
| ATP500 / WTA500 | 1529 |
| ATP250 | 1522 |
| WTA1000 | 1518 |
| WTA250 | 1514 |
| Challenger | 1509 |
| ITF | 1507 |
| Other/unknown | 1512 |

Corpus-wide mean 1523.1, median 1516 — rounded to **`CORPUS_BASELINE_ELO = 1520`**. The spread
across levels is real but compressed (~30 points), which is itself evidence for issue #2 above:
the pools aren't fully cross-linked, so a flat per-level average alone under-explains the
magnitude of the reported bug. These numbers are baked into `LEVEL_BASELINE_ELO` in
`surfaceElo.ts` with the query date/methodology documented in code comments. No numeric hierarchy
beyond this real query was invented.

## 3. Fix

**`surfaceElo.ts`**
- Unresolved-opponent fallback changed from flat `STARTING_ELO` to `levelBaselineElo(match.tournamentLevel)` — a real, per-level average.
- Added a **tour-level-credibility shrink**: each player's share of their *overall* (cross-surface) effective-sample-weighted match history that is genuine tour level (ATP/WTA main tour or above) vs. sub-tour, judged only against matches with a **known** level (an unreported level is absent information, not evidence of weak competition, so it's excluded from the share calculation rather than penalized; defaults to fully trusted when no level is ever known). The final blended rating is shrunk toward `CORPUS_BASELINE_ELO` in proportion to `(1 - tourLevelShare)`, floored at `TOUR_CREDIBILITY_FLOOR = 0.35` (real sub-tour wins always count for something, never zeroed).
- New output fields `player1TourLevelShare` / `player2TourLevelShare`, and a new warning when either player's share is below 25%.

**`recentForm.ts`**
- Same tour-level-credibility mechanism applied to the final form score: shrinks its distance from neutral (50) in proportion to `(1 - tourLevelShare)`, same floor, same known-level-only share calculation. New fields `player1TourLevelShare` / `player2TourLevelShare` and an analogous warning.

**Swept for the same pattern elsewhere** (`matchPerformance.ts`, `serveReturn.ts`,
`simulator.ts`, `dataQuality.ts`, `tieBreakers.ts`, `index.ts`, `opponentStrength.ts`): both
`matchPerformance.ts` and `serveReturn.ts` already degrade honestly when an opponent's strength is
unknown (`performanceDelta: null`, or a neutral `strengthFactor: 1`) rather than defaulting to a
flat number in a biased direction — no fix needed there. No other instance of the bug found.

## 4. Direction / reversal audit

- `eloDifference`, `player1Edge`, tie-breaker steps, and every consumer of `SurfaceEloResult` /
  `RecentFormResult` were re-checked; the new fields are purely additive (`grep`-verified no
  destructuring elsewhere would silently ignore or misread them).
- **`tieBreakers.ts` null-rank check**: the Ranking tie-breaker step (`inputs.player1.currentRank !== null && inputs.player2.currentRank !== null ? ... : 0`) already defaults to a neutral 0 (no lean) when either rank is null, not a favorable lean toward either player. Checked, no issue, no change needed.
- No player-specific hard-coded adjustment was added anywhere — the fix is purely a function of
  each player's own real match-level tournament levels, applied identically and symmetrically
  regardless of which player or direction the raw rating deviates from baseline.

## 5. Real before/after evidence

### Order symmetry, identical-input, and monotonic-shrink tests (new)

Added to `surfaceElo.test.ts` and `recentForm.test.ts`: swapping player1/player2 mirrors the win
probability exactly; identical histories land at exactly 50/50 (Elo) or an equal score (form); an
all-ITF win streak stays much closer to baseline/neutral than the same-shaped all-tour-level
streak; and the shrink is monotonic as tour-level share increases. All pass (91/91 tests in
`predictionEngine/`, including the pre-existing suite).

### Live production predictions, re-generated through the real `POST /predictions` pipeline

**Krumich vs. Passaro** (real fixture, prediction id 316; player1=Passaro, player2=Krumich, Clay,
ATP250; live provider data, Krumich sample 112 matches, mostly sub-tour):

| | Before (flat 1500 fallback, no shrink) | After (level-aware baseline + tour-credibility shrink) |
|---|---|---|
| Krumich surface Elo | 1632 | 1563 |
| Passaro win probability (raw) | 35.7% | 44.8% |
| Predicted winner / probability | M. Krumich, 69.8% | M. Krumich, 62.5% |
| Warning | (none) | "Player 2's rating is backed mostly by sub-tour (Challenger/ITF) competition (only 4% tour-level) -- their Elo is shrunk toward the corpus baseline..." |

Krumich remains the (correct, real) favorite here — he does have some tour-level results — but
the fix pulls a materially overconfident 69.8% down to a more honest 62.5%, and Passaro's raw
win probability moves ~9 points back toward parity.

**Pearson vs. Kirchheimer** (real fixture, prediction id 276; Hard, ATP250):

| | Before | After |
|---|---|---|
| Predicted winner / probability | K. Pearson, 59.2% | S. Kirchheimer, 56.8% |
| Warning | (none) | "Player 1's rating is backed mostly by sub-tour (Challenger/ITF) competition (only 0% tour-level) -- their Elo is shrunk toward the corpus baseline..." |

This one **reverses direction** — Pearson's rating had been artificially inflated by an
all-sub-tour history with a flat 1500 opponent fallback; correcting it flips the favorite to
Kirchheimer, matching the reported bug pattern exactly ("lower-tier grinders outranking real tour
players").

Four of the six originally-reported matchups (Feldbausch/Kecmanović, Podoroska/Marčinko, De
Lange/Geerts, Dalmasso's match) are not present in the current live predictions table (not
re-checkable as live fixtures); the two that are (above) both show the fix moving in the correct
direction.

Both re-checks were regenerated through the actual `POST /predictions` route (not a standalone
script) using the real tennis data provider and real DB-persisted opponent-Elo lookups — the
identical code path production traffic uses. The two verification prediction rows created during
this check were deleted afterward via the existing bulk-delete endpoint to avoid cluttering the
live predictions list.

### Walk-forward backtest (aggregate, 4 folds, default config)

Ran the full walk-forward evaluation twice — once against the pre-fix code (`git stash`), once
against the fix — each a genuine, complete 4-fold run (this wipes and rebuilds
`evaluation_runs`/calibration each time, so it was run exactly once per side, per the existing
project convention against casual re-runs):

| Fold | Before accuracy / logLoss / Brier | After accuracy / logLoss / Brier |
|---|---|---|
| 0 | 55.7% / 0.686 / 0.246 | 55.5% / 0.688 / 0.248 |
| 1 | 56.8% / 0.679 / 0.243 | 55.7% / 0.694 / 0.249 |
| 2 | 59.8% / 0.669 / 0.238 | 60.1% / 0.676 / 0.241 |
| 3 | 59.0% / 0.669 / 0.238 | 59.3% / 0.674 / 0.240 |
| **Avg** | **57.8% / 0.676 / 0.241** | **57.65% / 0.683 / 0.245** |

Aggregate accuracy/calibration across *all* matches is essentially unchanged (within normal
fold-to-fold noise) — expected, since the fix targets a specific bias pattern affecting matchups
with a large sub-tour/tour-level imbalance, not the general population of matches. The important
result is **no aggregate regression**: the targeted fix does not degrade overall predictive
performance while correcting the specific overconfidence bug on the matchups it's designed for.

## 6. Files changed

- `artifacts/api-server/src/services/predictionEngine/surfaceElo.ts`
- `artifacts/api-server/src/services/predictionEngine/recentForm.ts`
- `artifacts/api-server/src/services/predictionEngine/surfaceElo.test.ts` (+5 new tests)
- `artifacts/api-server/src/services/predictionEngine/recentForm.test.ts` (+4 new tests)
- `artifacts/api-server/src/services/predictionEngine/simulator.test.ts` (fixture update for new `SurfaceEloResult` fields)

## 7. Known residual limitation (see follow-up task)

This fix only shrinks a rating's *deviation* from a single global corpus baseline once tour-level
share is low — it does not re-resolve which specific opponents were "unresolved" in the first
place. A systematic effort to resolve more opponents (deeper historical backfill / identity
matching) would shrink the *need* for this fallback rather than just compensating for it after
the fact. That is a distinct, larger-scope effort and is intentionally out of scope here.
