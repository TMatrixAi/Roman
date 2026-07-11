---
name: Regex substring bugs in tournament-name lookup tables
description: Short, unanchored regexes matching tournament/venue names as substrings silently mislabel unrelated events; check every such table, not just the one you're editing.
---

Both `predictionEngine/surfaceMap.ts` (surface/tier lookup) and `predictionEngine/venueMap.ts`
(venue-coordinate lookup) independently had the same bug: short single-word regexes like
`/halle/i` or `/us open/i` with no word boundary match as a **substring** inside unrelated
lower-tier tournament names -- e.g. `/halle/i` matches inside "Challenger" (C-**halle**-nger),
silently mislabeling any Challenger event as the ATP500 grass event in Halle, Germany (both wrong
surface/tier AND wrong venue coordinates for travel-distance calculations).

**Why this matters:** these tables are looked up by literal tournament-name string matching (no
ID-based lookup exists), and lower-tier events (Challenger, ITF, qualifying, juniors) vastly
outnumber the majors/Masters events the tables are built for. A single missing word boundary
silently corrupts a large fraction of predictions with no error, no warning -- exactly the kind of
"looks confident but is wrong" bug this project's disclosure principles are meant to prevent.

**How to apply:** any new or edited regex-based name-lookup table (tournament surface/tier, venue
coordinates, or similar) must use `\b` word boundaries on every short/single-word entry, and should
add (or reuse) a `NEVER_NAMED_TABLE`-style guard (`/challenger|\bitf\b|\bqualif|\bjunior|\bboys\b|\bgirls\b/i`)
that skips the whole table for known lower-tier name patterns, since no major/Masters/500 event is
ever named that way. When touching one such table, grep the codebase for sibling tables (e.g.
`grep -rn "TOURNAMENT_" predictionEngine/`) and check them for the same bug rather than assuming
it's isolated -- both tables in this project had it independently.
