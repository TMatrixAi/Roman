# Injury / Travel / Rest-Day Data — Source Investigation

Date: 2026-07-11
Scope: evaluate every environment secret and provider available to this project for a verified
injury/withdrawal, travel, or rest-day signal, and wire in whatever proved real.

## 1. What was checked

- **`API_TENNIS_KEY` (active provider, `ApiTennisProvider`)**: no injury/withdrawal field on any
  endpoint (`get_fixtures`, `get_tournaments`, `get_H2H`, `get_standings`, `get_players`). No
  player-location or travel field either.
- **`API_SPORTS_KEY`**: attempted `https://v1.tennis.api-sports.io/status` and `/injuries` live —
  connection failed outright (no response at all, not even an auth error). API-Sports' public
  tennis product does not appear to be reachable with this key from this environment.
- **`RAPIDAPI_KEY`**: valid RapidAPI key (confirmed — requests reach RapidAPI's gateway and get a
  real "not subscribed" response rather than an auth failure), but not subscribed to any of the
  tennis-data APIs on RapidAPI's marketplace tried live (`tennisapi1`, `tennis-live-data`,
  `ultimate-tennis1`, `sportapi7`, `allsportsapi2`, `api-tennis` mirror, and others). No working
  host could be found for this key.

Conclusion, consistent with the Phase 1/2 audits' note that these two secrets "exist in the
environment but are not wired to any provider": there is still no reachable, verified structured
source for **pre-match** injury/withdrawal status or **player travel/location history**. This is
a genuine data-source gap, not something worth faking with a heuristic that looks verified but
isn't.

## 2. What IS real and now wired in (`predictionEngine/availability.ts`)

Rather than stop at "no source exists," three signals were identified that are 100% derived from
data this app already verifies, and are now a real engine input (not just a disclaimer):

1. **Rest days** — exact days between a player's most recent completed match (real date, from
   the provider) and the match being predicted.
2. **Travel distance** — real great-circle distance between the venue of a player's last match
   and this match's venue, using the same verified venue-coordinate table the weather module
   already relies on (`venueMap.ts`). Coverage is therefore only as good as that table's current
   ~18-tournament list (see the separate "cover known tournaments beyond ~18 majors" task).
3. **Recent retirement/withdrawal** — a player's own match record already carries `retired`/
   `walkover`/`result`. A `retired && result === "L"` match within the last 3 weeks means that
   player themself stopped play mid-match — a real recorded fact, disclosed as "worth weighing,"
   never claimed as a confirmed diagnosis of a current injury.

What remains genuinely unavailable and is disclosed as such on every prediction: withdrawal or
injury that hasn't yet caused an in-match retirement (i.e., true pre-match fitness/injury status).
No fabricated "fitness score" was added to paper over that gap.
