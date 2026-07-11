# Player Matching & Provider Coverage — Investigation & Fix

Date: 2026-07-11
Scope (Task #22): resolve player identity even when a player isn't in current ATP/WTA
standings, merge in supplementary-provider fields only where a real cross-provider match can be
verified, and honestly distinguish "no provider has this field" from "not yet fetched" in
warnings.

## 1. Is there a second real tennis data provider to merge from?

Re-checked live, specifically against player-search/player-lookup use cases (the Phase 4
availability audit on this same date only tested injury/travel endpoints):

- **`API_SPORTS_KEY`**: `https://v1.tennis.api-sports.io/players?search=...` — connection fails
  outright (curl exit, no HTTP response at all). Unreachable from this environment, same as the
  Phase 4 finding.
- **`RAPIDAPI_KEY`**: valid key (reaches RapidAPI's gateway), but returns `403 "You are not
  subscribed to this API"` on every tennis host tried (`tennisapi1`, `sportapi7`,
  `ultimate-tennis1`, plus the hosts already tried in the Phase 4 audit). No working host found.
- Checked Replit's integrations catalog for a tennis/sports data connector: none exists.

**Conclusion: there is still no second, reachable tennis data provider in this environment.**
Building "cross-provider identity matching" against a source that doesn't actually respond would
mean either faking the merge or writing dead code — both against this project's house style
(engine inputs are "absent, not faked" when a real source isn't connected). Nothing was merged in
from a second provider, and this is disclosed rather than papered over.

## 2. What was actually resolvable, and fixed

API-Tennis's `get_players` endpoint (used by `getPlayer`) is **not** restricted to players in the
current standings feed — confirmed live by calling it directly for `player_key=1189` (a
Challenger-tour player, real per-season singles/doubles stats returned). The real gap was that
this app's own `getPlayer`/`searchPlayers` wrapper only ever populated `tour`/`currentRank` from
the live ATP/WTA standings feed, and `searchPlayers` only scanned that same feed by name — so a
player who has never earned ranking points (pure Challenger/ITF/Junior competitors) was
unsearchable by name, and even a direct player-ID lookup silently returned `tour: null` with no
explanation.

This app already has a second real, verified, previously-fetched source of exactly these
players: **`historical_matches`** (the Phase 3 backfill table), which as of this audit holds
18,640 real matches with far broader roster coverage than the live standings feed:

| Tour        | Distinct player IDs (player1 side) |
|-------------|-------------------------------------|
| ATP         | 338                                   |
| WTA         | 270                                   |
| Challenger  | 785                                   |
| ITF         | 2,232                                 |
| Junior      | 109                                   |

That's ~3,100+ distinct Challenger/ITF/Junior players never covered by the live standings feed at
all (live testing showed the standings feed is broad — it includes players ranked in the
thousands — but players with **zero** ATP/WTA ranking history, e.g. juniors and ITF-only
competitors, are still absent from it).

**Fix implemented** (`services/tennisData/playerIdentity.ts`):
- `resolvePlayerProfile(provider, playerId)` — calls the provider first (works for any known
  `player_key` regardless of standings), and when the provider found the player but couldn't
  attach a live `tour` (not in current standings), falls back to that exact `player_key`'s most
  recent real row in `historical_matches` for `tour`. Every match here used is a real, exact
  `player_key` the provider itself reported — never a fuzzy name guess. Confirmed live: player
  `52677` (R. Vaksmann, ITF) now resolves with `tour: "ITF"`, `source: "historical-match"`,
  `currentRank: null` (honestly no live ranking), where it previously would have returned
  `tour: null` with no explanation at all.
- `searchKnownPlayers(provider, query)` — supplements the provider's own name search with a
  search over `historical_matches` player names (singles only; doubles pair rows, which are
  stored as `"NameA/ NameB"`, are excluded), for players the live search can't find. Confirmed
  live: searching "Vaksmann" now returns the ITF player with `source: "historical-match"`.
- Both routes and `predictions.ts`/`paperTrading.ts` were switched to use `resolvePlayerProfile`
  instead of calling `provider.getPlayer` directly, so both the standalone player-lookup UI and
  every prediction path get the same, better identity resolution.
- Added `fullName` to `PlayerProfile` — API-Tennis's `player_full_name` field was already being
  fetched and silently discarded; it's now returned (e.g. `"H. Mayot"` -> `"Harold Mayot"`).

## 3. Honest warning disclosure

`playerProfileWarnings.ts` adds a real, per-prediction warning distinguishing three states,
verified live end-to-end via a real prediction between a historical-match-only player and a
live-standings player:

- Resolved from live standings: no warning (nothing to disclose).
- Resolved via the historical-match fallback: `"<name> isn't in the current live ATP/WTA
  standings -- tour was resolved from their own most recent recorded match instead of a live
  ranking."`
- Genuinely unresolvable from any source (a player_key the provider has literally never returned
  a standings or historical-match row for): `"<name>'s tour/ranking could not be verified from
  live standings or any previously-fetched match record -- tour-dependent signals (e.g. the
  segment specialist) fall back to the general model for this player."`

## 4. What's explicitly out of scope / unchanged

- No fuzzy/heuristic name matching was added anywhere -- every historical-match identity result is
  an exact `player_key` match, never a "looks like the same person" guess.
- Real-time in-match stats remain out of scope (covered by other tasks).
- The primary provider for already-matched players is unchanged; this only ever *adds* identity
  coverage, never overrides an existing live-standings match.
