---
name: Player identity resolution beyond live standings
description: How this app resolves/searches tennis players not in the live ATP/WTA standings feed, and why no second provider is used.
---

`get_players` (API-Tennis) resolves any known `player_key` regardless of standings — it's only
`searchPlayers`/`tour` attachment that were standings-scoped. The real, honest fix (no second
provider needed) is a same-provider fallback: use our own already-fetched `historical_matches`
table as a second identity source for players outside current standings (Challenger/ITF/Junior).
Exact `player_key` matches only — never fuzzy name matching.

**Why:** API_SPORTS_KEY and RAPIDAPI_KEY were re-verified live (2026-07-11) against player-search
endpoints specifically (not just injuries/travel) — still unreachable/unsubscribed. No genuine
second tennis provider exists in this environment; don't build speculative cross-provider merge
code against a source that doesn't respond.

**How to apply:** `services/tennisData/playerIdentity.ts` (`resolvePlayerProfile`,
`searchKnownPlayers`) is the enrichment layer — call these instead of `provider.getPlayer`/
`searchPlayers` directly from routes/services. A `PlayerProfile.source` field
(`"live-standings" | "historical-match" | undefined`) discloses provenance; never collapse it to
a plain null. Doubles fixtures store a "NameA/ NameB" pair as one player row in
`historical_matches` — always filter those out of singles player-identity lookups.
