---
name: MatchStat provider & NFD transliteration
description: Key lessons from integrating the tennisapi1 provider and extending player name normalization
---

# MatchStat provider & NFD transliteration

## tennisapi1.p.rapidapi.com endpoint structure

The MatchStat provider wraps `tennisapi1.p.rapidapi.com` (Sofascore-based RapidAPI).
Known working path prefixes (confirmed by "Too many requests" rate-limit responses):
- `GET /api/tennis/rankings/atp` — ATP rankings
- `GET /api/tennis/rankings/wta` — WTA rankings
- `GET /api/tennis/player/{id}` — player profile
- `GET /api/tennis/player/{id}/results` — recent results
- `GET /api/tennis/schedules/games/{year}/{month}/{day}` — daily schedule
- `GET /api/tennis/players/h2h/{p1id}/{p2id}` — head-to-head

Response shape: JSON with typed sub-objects (`player`, `rankings[]`, `events[]`). 
HTTP 200 with `{"message": "..."}` body signals a subscription or routing error — treat as ProviderUnavailableError.

**Why:** RapidAPI rate limits return "Too many requests" before subscription checks, making rapid probing ambiguous. Implemented provider defensively; actual endpoint shapes will be confirmed on first live call.

**How to apply:** When debugging "not subscribed" errors from tennisapi1, wait 30+ seconds for rate limit to clear before probing — the two error messages are easily confused during rapid test sequences.

## NFD transliteration for non-decomposable characters

`normalizePlayerName()` uses a two-pass approach:
1. **Explicit transliteration** of characters that survive NFD unchanged: Đ/đ→d, Ł/ł→l, Ø/ø→o, ß→ss, Æ/æ→ae, Œ/œ→oe
2. **NFD + diacritic strip** for standard accented Latin characters

**Why:** `Đ` (U+0110, Serbian D-stroke) is not a precomposed base+diacritic — `.normalize("NFD")` leaves it unchanged. Without step 1, "Đoković" would survive as non-ASCII after the diacritic strip, never matching "dokovic".

**How to apply:** Any new character that appears in player names and doesn't decompose under NFD must be added to `NON_NFD_TRANSLITERATIONS` in `playerIdentity.ts`. Test with `"Đ".normalize("NFD").codePointAt(0)` — if it stays 0x110, it needs the explicit map.

## Composite provider pattern

`CompositeTennisProvider` wraps primary (MatchStat) + fallback (API-Tennis). Every method tries primary first; `ProviderUnavailableError` triggers fallback. Exception: `getCompletedMatchesByDateRange` always uses API-Tennis — MatchStat doesn't expose a bulk historical endpoint.

**Why:** Historical backfill pipeline REQUIRES the API-Tennis bulk date-range endpoint; the MatchStat provider returns `[]` for that method by design.

## Name variant generation

`generateNameVariants(name)` returns:
- Direct normalized form ("rafael nadal")
- Reversed word order ("nadal rafael")

`resolvePlayerNameWithAmbiguity()` returns `{ambiguous: false, id, confidence}` for exactly one canonical match, or `{ambiguous: true, candidates}` when multiple distinct IDs match across variants. Callers MUST surface the ambiguous case rather than guessing.
