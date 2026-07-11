---
name: API-Tennis provider quirks
description: Real-world behavior of the api-tennis.com API that diverges from its own documentation — read before building or debugging anything that calls it.
---

- `first_player_key`, `second_player_key`, `event_key`, and `player_key` are sometimes returned as JSON numbers even though the docs show string examples. Always coerce with `String(x)` before treating them as IDs, and type the raw fields as `string | number` at the fetch boundary.
- The provider has no surface field and no name-based player search endpoint. Surface/tournament-level must come from a maintained lookup table keyed by tournament name (falls back to `null`/"not available" for unmatched tournaments — never guess). Player search must be done by caching `get_standings` (ATP+WTA) and filtering client-side by name substring — this only covers currently-ranked players, not a full historical database.
- No point-level serve/return stats exist from this provider — any serve/return or style-matchup module must be a proxy derived from set/game score margins, explicitly labeled as a reduced-reliability estimate, not real serve stats.
- `tournament_name`/surface/tournament-level frequently come back `null` for the real data (e.g. Olympics, exhibitions). Any OpenAPI schema field sourced from this provider that can be genuinely unknown must be modeled as nullable (`oneOf: [$ref, {type: "null"}]` in OpenAPI 3.1), not just `.optional()` — optional only allows omitting the key, it still rejects an explicit `null` value via the generated zod schema.
- `get_fixtures` with only `date_start`/`date_stop` (no `player_key`) returns ALL matches tour-wide for that window — this is the only practical way to bulk-backfill historical data (confirmed real coverage back to ~2010). But responses are huge (~30MB/week during busy periods) and ~2-week+ windows return HTTP 500; chunk requests to ~5 days.
