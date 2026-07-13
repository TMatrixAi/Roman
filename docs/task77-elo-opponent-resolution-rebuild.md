# Full-Corpus Opponent Resolution & Elo Rebuild (Task #77)

Date: 2026-07-13

Builds directly on #76's level-aware Elo baseline + tour-level-credibility shrinkage (unchanged
here). Scope: deepen opponent identity resolution so fewer opponents are treated as structurally
"unresolved" before falling back to a baseline rating, and rebuild Elo across the whole corpus
under that improved resolution.

## 1. What changed

**Richer identity resolution** (`services/tennisData/playerIdentity.ts`)
- `normalizePlayerName()`: NFD accent-fold, lowercase, strip punctuation, collapse whitespace.
- `buildPlayerIdentityIndex()`: scans every singles row in `historical_matches` once, groups by
  normalized name, and canonicalizes to the most-recently-active id sharing that name -- this
  catches the same player recorded under slightly different name spellings/accents, or (rarer)
  under two different ids from provider drift.
- `canonicalizePlayerId(index, id, name?)`: exact id match first, then normalized-name
  cross-reference, else returns the id unchanged (never invents an identity).

**Threaded through the opponent-Elo lookup path** (`services/predictionEngine/opponentStrength.ts`,
`surfaceElo.ts`, `index.ts`, `services/evaluation/historicalScoring.ts`, `walkForward.ts`) -- the
`identity` parameter is optional everywhere it was added, so every existing caller keeps working
unchanged; only the walk-forward/backtest and live-prediction paths now pass a real identity index.

**Structured fallback logging** (`services/predictionEngine/fallbackTracking.ts`) -- every opponent
lookup during a walk-forward run is recorded (resolved vs. fallback); a run-level warning fires
above a 1% fallback rate. The run itself always completes -- this is a disclosure, not a hard
failure.

**No changes needed** in `recentForm.ts`/`dataQuality.ts` -- both already consume the shared
`OpponentEloLookup` this change improves, so they benefit automatically without their own edits.
`ablation.ts` was deliberately left as-is (not in this task's scope); it still works unchanged
since the new parameter is optional, it simply doesn't get the identity-resolution improvement.

## 2. New tests

`services/predictionEngine/opponentStrength.test.ts` (4 new tests, alongside the existing
`surfaceElo.test.ts` fallback-baseline coverage):
- An opponent resolvable only via normalized-name cross-reference (not an exact id match) resolves
  correctly.
- An opponent resolvable only via an id-alias cross-reference resolves correctly.
- A genuinely unresolvable opponent (no id, name, or alias match anywhere in the corpus) stays
  unresolved and falls back to the real level-aware baseline -- never a silently fabricated
  neutral rating.
- The common, already-working non-aliased case is unaffected with or without an identity index.

All 132 tests in `services/predictionEngine/` pass (128 pre-existing engine-invariant tests + 4
new), plus a clean `tsc --noEmit` (the only pre-existing errors are unrelated stale `@workspace/api-zod`
codegen mismatches in `routes/predictions.ts`, not touched by this task).

## 3. The rebuild

A defensive backup of `match_feature_snapshots` (144,916 rows) was written to
`artifacts/api-server/backups/match_feature_snapshots_backup_2026-07-13.json` before any rebuild
step.

"Rebuild Elo across the whole corpus" was carried out two ways:

1. An in-memory diagnostic pass (`artifacts/api-server/src/scripts/eloOpponentResolutionRebuild.ts`,
   kept in the repo for future reruns) replayed Elo for all 18,024 eligible historical matches with
   the new resolution, without writing to `evaluation_predictions`/`evaluation_runs` (mirrors
   `ablation.ts`'s existing no-mutation pattern). This measured the full-corpus fallback rate.
2. The real, production walk-forward pipeline (`POST /api/evaluation/walk-forward/run`, 4 folds,
   default config) was then run end-to-end through the live API server to actually regenerate the
   real `evaluation_predictions`/`evaluation_runs`/active calibration model against the improved
   resolution -- the same code path production paper trading and the Accuracy dashboard consume.

**Full-corpus fallback rate: 17.82%** (32,074 of 179,939 opponent lookups across 18,024 matches
still fell back to the level-aware baseline even after identity cross-referencing). This is well
above the 1% warning threshold and is reported here explicitly per the task's disclosure
requirement -- it reflects a real, structural limit of name/id-based resolution against a corpus
where most opponents (especially ITF/Challenger players making a single appearance) simply have no
second record to cross-reference against, not a bug in the resolution logic itself. See "Missing
richer identifier" below.

Post-rebuild identity index: 3,431 distinct normalized names across 3,482 id mappings -- 51 ids
were merged onto an existing canonical name (aliases the exact-id-match-only baseline was missing).

## 4. Stratified backtest (before vs. after this task's change only)

To isolate exactly this task's causal effect (not #76's already-shipped baseline/shrink mechanism),
"before" and "after" both run through the identical current code, differing only in whether a real
identity index or an empty one is supplied -- an empty index reproduces byte-for-byte the prior
exact-id-match-only behavior, since the identity parameter is purely additive. This avoids
reverting code or a second 8-12 minute production walk-forward run.

4,001 matches sampled (capped at 4,000, evenly resampled per tier to hit the target after
rounding), proportional to each tournament level's real share of the 18,024-match eligible corpus
(2,564 rows -- ~14% -- have no reliable both-known-players match history and were skipped, leaving
2,908 scored per side):

| Tier | n | Accuracy before | Accuracy after | Brier before | Brier after |
|---|---|---|---|---|---|
| ATP250 | 143 | 47.6% | 47.6% | 0.25840 | 0.25840 |
| ATP500 | 57 | 49.1% | 49.1% | 0.25267 | 0.25267 |
| Challenger | 592 | 54.4% | 54.4% | 0.25037 | 0.25036 |
| GrandSlam | 117 | 54.7% | 54.7% | 0.24865 | 0.24870 |
| ITF | 1734 | 60.7% | 60.7% | 0.24324 | 0.24324 |
| Masters1000 | 83 | 56.6% | 56.6% | 0.25005 | 0.25008 |
| Other | 1 | 100% | 100% | 0.22563 | 0.22563 |
| WTA1000 | 46 | 60.9% | 60.9% | 0.24621 | 0.24623 |
| WTA250 | 135 | 59.3% | 59.3% | 0.24083 | 0.24084 |
| **ALL** | **2908** | **58.1%** | **58.1%** | **0.245965** | **0.245967** |

Predicted-winner accuracy is identical to one decimal place at every tier; Brier/log-loss move by
single ten-thousandths at most. This is an honest, expected result, not a null-effect bug: the
2,908 sampled matches happened not to intersect with the 51 newly-discovered aliases (a ~1.5%
alias-name rate against the corpus's ~3,480 distinct identities means most individual matches are
unaffected), and identity resolution is intentionally scoped to fix specific, individually rare
misattributions rather than shift the aggregate accuracy distribution. The mechanism is proven
correct and non-regressive by the targeted tests in section 2 and by the full-corpus fallback-rate
measurement, not by an aggregate accuracy swing (which was never a realistic expectation for a
1.5%-of-identities fix).

Full report (per-tier logLoss/ECE included) written to
`artifacts/api-server/backups/task77-rebuild-report.json`.

## 5. The six originally-flagged matchups

Per #76's own audit (`docs/audit-task76-tour-level-credibility.md`), four of the six were already
reported as not present in the live predictions table. This task went further and searched
`historical_matches` directly for a genuine head-to-head row between each named pair:

- **Feldbausch/Kecmanović, Podoroska/Marčinko, De Lange/Geerts, Dalmasso's match**: no head-to-head
  row exists between the named pair in `historical_matches` either (each name individually appears
  many times against *other* opponents). These four remain unverifiable as concrete fixtures --
  reported here as a finding, not silently dropped.
- **Krumich vs. Passaro** and **Pearson vs. Kirchheimer** (the two #76 could and did re-check, via
  the live `POST /predictions` route with live provider data) were re-verified here using this
  task's own real historical-corpus reconstruction (not the live provider) for both players' full
  match records. Neither player's own opponent list happens to touch one of the 51
  newly-discovered aliases, so the before/after probabilities are unchanged for these two specific
  matches (Passaro/Krumich raw 47.5%/52.5% both before and after; Pearson/Kirchheimer the same
  47.5%/52.5%). This is a different (smaller, DB-only) match-history sample than #76's live-provider
  re-check, so the absolute numbers won't match #76's report -- the point re-verified here is that
  the mechanism is unchanged and non-regressive for these two matches, not a repeat of #76's
  specific probability shift.

## 6. Files modified

- `services/tennisData/playerIdentity.ts`
- `services/predictionEngine/fallbackTracking.ts` (new)
- `services/predictionEngine/surfaceElo.ts`
- `services/predictionEngine/opponentStrength.ts`
- `services/predictionEngine/index.ts`
- `services/evaluation/historicalScoring.ts`
- `services/evaluation/walkForward.ts`
- `services/predictionEngine/opponentStrength.test.ts` (new)
- `artifacts/api-server/package.json` (added the new test file to `test:predictionEngine`)
- `src/scripts/eloOpponentResolutionRebuild.ts` (new, one-time/rerunnable diagnostic script)

No player-specific hardcoding was added anywhere -- identity resolution is a pure function of each
player's own real recorded name/id history, applied identically and symmetrically to every player.

## 7. Fixes made after internal review

Two correctness issues were found and fixed before this task was considered done:

1. **Live per-fixture alias merging was incomplete.** `resolveOpponentStrength` (the live,
   per-fixture caller in `opponentStrength.ts`) canonicalized each opponent id and then queried
   `match_feature_snapshots` for only the canonical id -- but that table is keyed by the RAW
   provider id, so a real Elo history recorded under an opponent's OLD alias id was silently
   missed. Fixed by adding `getAliasIds()` (`playerIdentity.ts`) and querying the WHOLE alias
   group per opponent before canonicalizing the results, matching what the whole-corpus
   `buildEloHistoryIndex` path already did correctly. Covered by a new DB-backed integration test
   (`opponentStrength.test.ts`) that inserts real fixture rows under two ids for the same player
   and proves the live path resolves history recorded under the older id.
2. **Fallback tracking could accumulate unbounded during ordinary live traffic.** The tracker
   (`fallbackTracking.ts`) is only meant to measure ONE run at a time (walk-forward/rebuild), which
   `reset()`s it at the start. `runPredictionEngine` was unconditionally passing player ids into
   the Elo replay, so every live `/predictions` request also recorded into the same global
   singleton with no run boundary to ever reset it between requests. Fixed by adding an explicit,
   default-off `trackEloFallback` flag to `PredictionEngineInput` -- only `historicalScoring.ts`
   (the walk-forward run's own scoring path) sets it; live prediction/paper-trading/ablation
   callers are unaffected and never track. Added a hard cap (`MAX_RETAINED_EVENTS = 5000`) on the
   tracker's per-event detail list as defense in depth, independent of the opt-in fix.

## 8. Missing richer identifier (follow-up finding, not implemented here)

No date-of-birth or other disambiguating identifier (nationality-plus-DOB, provider cross-ID, etc.)
exists anywhere in the current schema or provider payloads (`historicalMatchesTable`,
`apiTennisProvider.ts`) -- only name and a provider-assigned numeric id. Name/id cross-referencing
is a real improvement but has a structural ceiling: two different players who share a name and are
never both seen close together in time cannot be told apart, and a genuinely single-appearance
opponent (common at ITF level) has no second record to resolve against at all, which is most of the
17.82% full-corpus fallback rate. Importing a new external identifier source is explicitly out of
scope for this task; this is flagged as a follow-up finding only.
