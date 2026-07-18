---
name: tennis-api-atp-wta-itf endpoint map
description: Confirmed working endpoints, response shapes, and known gaps for tennis-api-atp-wta-itf.p.rapidapi.com (RapidAPI BASIC plan, ~$7.99/mo)
---

## Confirmed working endpoints

| Endpoint | Method | Status |
|---|---|---|
| `/tennis/v2/ms-api/upcoming/matches/atp` | GET | ✅ 200 |
| `/tennis/v2/ms-api/upcoming/matches/wta` | GET | ✅ 200 |
| `/tennis/v2/ms-api/ranking/{tour}?date=YYYY-MM-DD&group=race` | GET | ✅ 200 |

## Confirmed NOT available (404 from all patterns tried)

- Player profile by ID, name slug, or underscore slug
- Player match history / results
- H2H detail (only embedded inline in upcoming matches as `"W1-W2"` string)
- Completed/historical results by date
- Schedule by date
- Any endpoint taking a player name slug or numeric player ID as a path param

## Response shape — upcoming/matches/{tour}

```json
{
  "total": 10,
  "matches": [{
    "tournament": { "id": 21340, "name": "...", "date": "ISO", "rankId": 2, "country": "SUI", "court": { "name": "Clay" } },
    "court": "Clay",
    "roundId": 10,
    "rank": 2,
    "date": "2026-07-18T12:00:00.000Z",
    "type": "atp",
    "odds": { "k1": 1.658, "k2": 2.35, "total": 2.5 },
    "player1": { "id": 84235, "name": "Raphael Collignon", "countryAcr": "BEL", "seed": "7", "odd": "1.61" },
    "player2": { "id": 52934, "name": "Juan Manuel Cerundolo", "countryAcr": "ARG" },
    "h2h": "0-1"
  }]
}
```

## rankId → TournamentLevel mapping (confirmed from data)
- 1 = GrandSlam
- 2 = ATP250 / WTA250
- 3 = ATP500 / WTA500
- 4 = Masters1000 / WTA1000
- 5 = Challenger (assumed)

## Rankings group values
- `group=race` → works, returns Race to Turin / Race to Singapore standings (array of 100)
- `group=singles`, `group=atp`, `group=1`, `group=2`, `group=ATP Singles`, `group=Pepperstone ATP Rankings`, etc. → all "Group not found!"
- Live ATP/WTA ranking group value: **still unknown**

## Rate limits (BASIC plan)
- Daily quota: appears to be a few hundred requests/day. Exhausted after ~30 probe calls + grading startup burst.
- Rate limit window: approximately 1 request per 4 seconds (alternating 429 pattern at 2s spacing)
- On quota exhaustion: HTTP 200 with `{"message":"You have exceeded the DAILY quota..."}` body, then 429 on subsequent calls until reset
- The provider's `{message}` check catches quota exhaustion correctly and falls through to API-Tennis

## Authentication
- The key in `x_rapidapi_key` IS subscribed to this API (confirmed via 404 "endpoint does not exist" vs 403 "not subscribed")
- Earlier 403 "not subscribed" errors were caused by the rate limit window being exhausted from 88 simultaneous grading calls — NOT a real subscription issue

## What the provider now does
- `getUpcomingFixtures`/`getUpcomingFixturesRange`: fetches both ATP and WTA from confirmed endpoints, filters by date
- `searchPlayers`: uses `group=race` rankings (Race to Turin/Singapore — NOT live ATP ranking)
- `getPlayerMatches`, `getPlayer`, `getHeadToHead`: throw ProviderUnavailableError immediately (no HTTP call wasted), route to API-Tennis
- `getCompletedMatchesByDateRange`, `getLiveScores`: return empty, API-Tennis handles these

**Why:** This API is prediction-focused. Its data model doesn't expose per-player history or completed results at the BASIC tier.
