# Phase 2 Audit — API Validation, Fake-Data Sweep, Identity-Matching Hardening

Date: 2026-07-11
Scope: `artifacts/api-server` (tennisData provider layer, prediction engine, routes),
identity matching for players/tournaments, and the data-source reference this project needs
before Phase 3 (historical data architecture) can honestly build on top of it.

Builds on `docs/audit-phase1.md`, which already fixed several correctness bugs (doubles
best-of-5 misclassification, required-param validation, tiebreak score truncation, typecheck
failures) and flagged three items as explicitly deferred to Phase 2: evaluating whether a
second data provider is needed, hardening player identity matching, and reviewing
surface/tournament-level inference coverage. This report closes out that Phase 2 scope.

## 1. Method

1. Hit every live API-Tennis method the app uses (`get_standings`, `get_players`,
   `get_fixtures`, `get_H2H`, `get_events`) directly against the real API, not just the
   provider's documentation, and compared actual response shapes/behavior against what the
   code assumes.
2. Grepped `predictionEngine/` and `services/tennisData/` for hardcoded fallbacks, default
   values, and any place a "no data" case could be silently turned into a misleading number.
3. Probed player search specifically for the two failure modes called out in the task:
   ambiguous/duplicate names and players absent from current rankings (retired, ITF/Challenger
   only).
4. Quantified surface/tournament-level lookup-table coverage against a live 7-day fixtures
   pull spanning ATP/WTA/Challenger/ITF.

## 2. API contract verification (live, 2026-07-11)

| Method | Assumption in code | Verified live behavior | Discrepancy? |
|---|---|---|---|
| `get_standings` (ATP, WTA) | Returns full ranked list, `place` numeric-as-string, `player_key` may be string or number | Confirmed: 3,838 combined rows, `place` always numeric string, no duplicate `player_key` or duplicate player names within the current snapshot | None found this pass (numeric/string `player_key` coercion already handled per Phase 1) |
| `get_players` with `player_key` | Returns one player's profile | Confirmed for both standings-listed and non-standings (Challenger/ITF) keys | Doubles-match player keys return a concatenated pair name (e.g. `"Arseneault/ Arseneault"`) instead of one person — a real provider quirk, not a bug in this app (see §5) |
| `get_players` with `player_name` | *(not used in code)* | **Provider does not support name search at all.** Live call returns `{"cod":201,"msg":"Required parameter missing","param":"player_key"}` regardless of what other params are passed | Confirms `get_players` is lookup-by-ID only; there is no name-search endpoint anywhere in this provider. Player search must and does go through `get_standings` only — this is now documented at the call site (see §4) |
| `get_fixtures` | Returns finished/upcoming matches with scores as decimal-tiebreak strings | Confirmed decimal tiebreak encoding (Phase 1 finding still holds); live pull found 43 distinct tournaments in one week, only 1 of which is a "marquee" event | Not a bug, but quantifies the surface-map coverage gap precisely (see §4) |
| `get_H2H` | Returns `{ H2H: RawMatch[] }` | Confirmed shape and filtering (finished matches with a winner) | None |

No new response-shape discrepancies were found beyond what Phase 1 already fixed. The one
substantive finding this pass is behavioral, not shape-based: **`get_players` cannot search by
name under any parameter combination** — this was previously undocumented and is the root
cause of the identity-matching gap in §4.

## 3. Fake/placeholder data sweep

Result: **no fabricated or silently-defaulted data was found.** Every module already follows
the "explicit null over plausible guess" rule:

- `opponentRank`, `stats`, `opponentStats` on every `MatchRecord` are hardcoded to `null`
  (`apiTennisProvider.ts`) because the provider does not supply per-point serve/return stats
  or historical opponent rank at match time — not proxied, not guessed.
- `serveReturn.ts` computes a serve/return **proxy** from game-margins (explicitly labeled as
  a proxy, not real serve stats, both in code comments and in the UI's data-quality
  reliability indicator).
- `surfaceElo.ts` starts every player at a flat Elo of 1500 and treats unknown opponents as
  league-average — a documented modeling simplification (Phase 5/6 scope to replace with real
  opponent-strength propagation), not a fabricated per-match value.
- `surfaceMap.ts` returns `null` surface/level for anything outside its lookup table rather
  than guessing from other signals.
- `predictionEngine/index.ts` ships explicit `availabilityNote` and `conditionsNote` strings
  telling the user that injury/availability and live conditions are not connected — these are
  disclaimers, not fabricated inputs.
- `NotConfiguredProvider` (`services/tennisData/index.ts`) returns a clean `502` with a
  descriptive error when `API_TENNIS_KEY` is unset; it never falls back to mock/sample data.

No hardcoded magic numbers found are disguised as real data — every constant identified
(Elo starting value, K-factor, decay rates, reliability weights, etc.) is a documented modeling
parameter for a derived score, not a stand-in for a missing real-world fact.

## 4. Identity-matching hardening (this phase's main change)

**Root cause identified:** API-Tennis has no name-search endpoint. `get_players` requires an
exact `player_key`; the *only* way this app can resolve a name to an ID is by scanning the
`get_standings` snapshot, which only lists players currently ranked on the ATP or WTA main
tour. This was true before this phase too, but was undocumented and the search ranking was
arbitrary (whichever tour's array came first).

Changes made in `apiTennisProvider.ts` `searchPlayers()`:
- **De-duplication by `player_key`** — defensive against any future provider overlap between
  tour lists (none found in the current snapshot, but not guaranteed going forward).
- **Deterministic, relevance-ordered ranking** — exact case-insensitive name matches now sort
  before partial/substring matches, and ties break by current rank ascending (unranked/
  unparseable ranks sort last). Previously results were returned in raw standings-array order
  (all ATP entries before all WTA entries), which could bury an exact or higher-profile match
  under a lower-relevance one when a query matched people on both tours.
- **Explicit scope disclosure, not silent emptiness** — the "no players found" case in the
  frontend (`PlayerSearch.tsx`) now tells the user the search only covers current ATP/WTA
  rankings, instead of implying the player doesn't exist. The code path also carries an
  inline comment documenting this as a hard provider limitation for future maintainers.

**What could not be fixed within the current provider** (see §6 for the escalation): there is
no way to search for retired players (e.g. Federer — confirmed absent from live ATP standings)
or Challenger/ITF-only players by name. Their `player_key` is only reachable indirectly, e.g.
by already knowing it from a fixture. This is a genuine data-source gap, not a bug in this
app's code.

**Ambiguity check performed:** scanned the full live combined ATP+WTA standings (3,838 rows)
for duplicate player names or `player_key` collisions across different names. Found **zero**
in the current snapshot — there is no live case today of two same-named players confusing the
matcher. The de-duplication/ranking hardening above is forward-looking protection, not a fix
for an observed collision.

**Surface/tournament-level inference gaps (`surfaceMap.ts`):** quantified against a live 7-day
fixtures pull across ATP/WTA/Challenger/ITF: 43 distinct tournament names appeared, and only
1 (Wimbledon) matched the lookup table. The table intentionally covers Grand Slams,
Masters1000/WTA1000, and prominent 500-level events only, and returns `null` (not a guess) for
everything else — that design choice is correct and already documented, but the *practical*
consequence is now made explicit inline and here: most Challenger/ITF match history (the
majority of matches for any non-top-100 player) carries no surface or tournament-level label,
which will limit the surfaceElo module's usefulness for lower-ranked matchups until this is
addressed (Phase 5 scope, or a second data source — see §6).

## 5. Other quirks confirmed live (documented, no code change needed)

- Doubles-match player keys resolve via `get_players` to a concatenated pair name (e.g.
  `"Arseneault/ Arseneault"`) rather than one individual — a provider data quirk for doubles
  entries. This app's prediction/search flows are singles-focused and don't currently surface
  doubles player profiles to users, so no fix was needed, but noted here in case doubles
  support is added later.
- `get_events` confirms the full set of event-type strings used by `determineMatchFormat`'s
  regex matching (Atp/Wta Singles/Doubles, Challenger, ITF, Boys/Girls, Exhibition, Teams,
  Mixed) — no undocumented event types were found that would misclassify match format.

## 6. Genuine data gaps to flag to the user (not fixed in this phase, per scope)

Two real, provider-level gaps were confirmed live. Both would require either a second paid
data source or a different product decision, so per Phase 2's scope boundaries they are
flagged here rather than acted on:

1. **No way to search for or predict on retired/non-currently-ranked players.** Confirmed:
   `get_players` has no name-search capability, and the standings feed (the only searchable
   index) excludes anyone off the current ATP/WTA rankings. If the product needs historical
   greats or recently-retired players to be searchable, that requires either a provider with a
   full player database + name search, or a manually-maintained player-ID lookup table seeded
   once and kept in sync — a real cost either way, not something to add silently.
2. **Surface/tournament-level data is unavailable for ~95%+ of live tournament names**
   (42 of 43 in the sampled week) because API-Tennis doesn't report court surface and this
   app's static lookup table only covers marquee events by design. If Phase 5's
   surface-adjustment work needs surface labels for Challenger/ITF matches, closing this gap
   means either a second provider that reports surface per-fixture, or manually extending the
   lookup table tournament-by-tournament (labor-intensive and always trailing new events).

Recommendation: defer a decision on both until Phase 5/6 scope is concrete enough to know
whether the gap actually blocks a specific model improvement — evaluating a paid provider
change is explicitly out of scope for Phase 2 without checking in first, per the task
boundaries.

## 7. Data-source reference (what Phase 3+ can honestly build on)

| Field | Source | Status | Caveats |
|---|---|---|---|
| Player id, name | `get_standings` / `get_players` | **Real** | Only ATP/WTA-ranked players are searchable by name; any `player_key` (including non-ranked) works for direct lookup |
| Player country | `get_players.player_country`, fallback `get_standings.country` | **Real** | Occasionally null upstream (1 of 3,838 rows in this sample) |
| Player current rank / tour | `get_standings.place` / `.league` | **Real** | `null` for anyone not on current ATP/WTA standings (retired, Challenger/ITF-only) |
| Player age | Derived from `player_bday` | **Real** (derived) | `null` if birthdate missing upstream; doubles-key lookups return no birthdate |
| Player "plays" (handedness) | — | **Unavailable** | Not provided by API-Tennis at all; always `null` |
| Match date/score/winner | `get_fixtures` / `get_H2H` | **Real** | Tiebreak set scores are truncated to whole games (e.g. `7-6`), tiebreak point count is discarded — provider encodes it ambiguously as a decimal |
| Match format (Bo3/Bo5) | Derived from `event_type_type` + tournament level | **Real** (derived, rule-based) | Correctly excludes doubles from Bo5-at-Slams; relies on level inference below for the Slam check |
| Surface | `surfaceMap.ts` lookup by tournament name | **Real for ~40 marquee tournaments; unavailable (`null`) otherwise** | Confirmed only 1/43 live tournaments in a sample week resolved; see §4/§6 |
| Tournament level | Same lookup table | **Real for marquee events; unavailable otherwise** | Same gap as surface |
| Opponent rank (at match time) | — | **Unavailable** | Provider doesn't return historical rank-at-match-time; explicitly `null`, never backfilled from current rank |
| Serve/return stats (aces, first-serve%, etc.) | — | **Unavailable** | Provider has no point-level stats; `serveReturn` module computes a **proxy** from game-margins instead (labeled as such) |
| Head-to-head meetings | `get_H2H` | **Real** | Filtered to finished matches with a recorded winner |
| Surface Elo, recent form, fatigue, style-matchup scores | Computed in `predictionEngine/` from the real match records above | **Derived models**, not raw data | Each carries its own `reliability` score surfaced to the user via `DataWarning`; starting Elo (1500) and opponent-strength assumptions are documented simplifications, not fake per-match data |
| Injury/availability, live conditions/court speed | — | **Unavailable** | Explicit `availabilityNote` / `conditionsNote` strings ship with every prediction so the UI never implies these were considered |

## 8. Verification performed

- Live calls: `get_standings` (ATP+WTA), `get_players` (by key, standings and non-standings
  players), `get_fixtures` (7-day window across all levels), `get_H2H`, `get_events`.
- Reviewed every write path in `predictionEngine/` for hardcoded fallbacks; confirmed none
  masquerade as real data.
- `pnpm run typecheck` passes after the `searchPlayers` and UI changes in this phase.
- Verified the search UI change and provider change together via a workflow restart and
  manual player-search flow in the running app.

## 9. Not in scope / explicitly not built

Per the task's scope boundaries: no new paid data provider (API_SPORTS_KEY, RAPIDAPI_KEY) was
wired up, and no screenshot-import/OCR feature was built (none exists in this codebase, per
Phase 1's audit) — both are flagged as open questions in §6 rather than acted on unilaterally.
