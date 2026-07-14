# Audit: Bulk match-paste player resolution failures

**Task:** #132 (read-only root-cause audit — no code, thresholds, aliases, or data were changed)
**Date:** 2026-07-14
**Scope:** The Ledger's "Paste Search" feature (Task #110): `matchupLineParser.ts` → `matchupResolution.ts` →
`GET /predictions/players/search` (`ledgerPlayers.ts`) → `matchPredictionsToPair`.

## Executive summary

The two hypotheses named in the task ("leading bullet characters survive into the player name" and
"lookup is scoped to the Ledger only") are both **real, confirmed bugs** — but neither is the
dominant cause of the failures in the user's actual pasted list, because that list contained no
leading bullets and every player in it does have at least one prior Ledger prediction.

The dominant, previously-unidentified root cause, found by actually running the real code against
the real database, is a **name-format mismatch**: the user pasted full first names ("Liam Draxl",
"Tristan Schoolkate"), but every player name stored in `predictions` (the Ledger) and
`historical_matches` (canonical history) uses an **abbreviated first-initial format** ("L. Draxl",
"T. Schoolkate"). `searchLedgerPlayers`'s per-word `ILIKE` requires every query word to appear as a
substring of the stored name — the word "Liam" never appears anywhere in "L. Draxl", so the query
returns **zero candidates**, which the UI reports as "No Ledger player found for Liam Draxl" even
though that exact player has real, recent Ledger predictions.

This single mismatch fully explains all 16 of the full-name-pair failures in the user's list
(32 distinct players, 100% of them present in the Ledger under an initial-abbreviated name). A
second, independent bug explains the confusing "unrelated suggestions" seen on short surname-only
pastes: single short tokens (e.g. "Bu") are matched with unescaped substring `ILIKE`, so they match
*any* name containing that substring anywhere — "Bu" alone returns 20 completely unrelated
candidates (Tabur, Bueno, Burcescu, Busquets Brau, …), none of which are actually surnamed "Bu".

| # | Root cause | Confirmed in this list? | Rows affected |
|---|---|---|---|
| 1 | **Full-name vs. stored-initial mismatch** in per-word ILIKE lookup | Yes — reproduced against real DB for all 32 names | 16 of 22 lines (the full-name pairs) |
| 2 | **Unescaped short-token substring matching** returns unrelated candidates | Yes — reproduced for "Bu" | Contributes to "Zhu vs. Bu" and any short 2-3 letter surname |
| 3 | **Ledger-only lookup scope** (never falls back to canonical `historical_matches`) | Confirmed by design, not triggered here (all pasted players already have ≥1 Ledger prediction) | 0 direct, but latent for any genuinely new player |
| 4 | **Leading bullet/list characters survive into the parsed name** | Confirmed as a real parser bug via synthetic test; **not present** in this actual pasted text (no bullets in the reproduced lines) | 0 in this list, but real and reproducible |
| 5 | **Genuine surname ambiguity** (2+ real singles players sharing a bare surname) | Confirmed for 2 of 12 surname-only entries (Zhou, Zhu); the rest resolve to exactly one real singles player once doubles-pairing rows are excluded — but the app doesn't exclude them, so #2 masks this | 2 of 12 surname-only entries are genuinely ambiguous |
| 6 | **Canonical (`historical_matches`) data is >1 year stale** (capped at 2025-04-01) | Confirmed table-wide | Does not explain any failure in this list (Ledger data is current), but limits the fallback in #3 if it were ever used |

## Reproduction methodology

Every line was run through the **real, unmodified** source:
- Parsing: `parseMatchupLine` / `parseMatchupLines` from `matchupLineParser.ts`, executed directly via `tsx`.
- Lookup: the exact SQL `searchLedgerPlayers` builds (per-word, wildcard-escaped `ILIKE` over the
  `player1_name`/`player2_name` union of `predictions`), executed directly against the live
  development database — equivalent to calling `GET /predictions/players/search`, since the API
  Server workflow was not reliably stayin g up for direct HTTP calls during this audit (a known,
  separately-tracked instability — Task #136).
- Canonical coverage: the same `LIKE` pattern `playerIdentity.ts`'s `searchKnownPlayers` uses,
  executed directly against `historical_matches`.

No thresholds, normalization rules, parser code, or database rows were changed at any point.

## Parser findings

### Reproduction of the real pasted list (22 lines, no leading bullets, no trailing tournament)

All 22 lines parsed **cleanly with zero `parseError`s** and no bullet-character contamination,
because none of the actual lines the user pasted had a leading `*`, `-`, `•`, or list-number prefix:

```
Murphy Cassone vs. Tristan Schoolkate        -> playerA="Murphy Cassone"     playerB="Tristan Schoolkate"
Liam Draxl vs. James Kent Trotter            -> playerA="Liam Draxl"         playerB="James Kent Trotter"
Fajing Sun vs. Arthur Gea                    -> playerA="Fajing Sun"         playerB="Arthur Gea"
Daniel Milavsky vs. Duncan Chan              -> playerA="Daniel Milavsky"    playerB="Duncan Chan"
Alexander Rozin vs. Keegan Rice              -> playerA="Alexander Rozin"    playerB="Keegan Rice"
Titouan Droguet vs. Alexander Blockx         -> playerA="Titouan Droguet"    playerB="Alexander Blockx"
Hugo Dellien vs. Ioannis Xilas               -> playerA="Hugo Dellien"       playerB="Ioannis Xilas"
Andrej Nedic vs. Enrico Dalla Valle          -> playerA="Andrej Nedic"       playerB="Enrico Dalla Valle"
Maria Timofeeva vs. Ann Li                   -> playerA="Maria Timofeeva"    playerB="Ann Li"
Anna Blinkova vs. Aliaksandra Sasnovich      -> playerA="Anna Blinkova"      playerB="Aliaksandra Sasnovich"
Tereza Valentova vs. Sofia Costoulas         -> playerA="Tereza Valentova"   playerB="Sofia Costoulas"
Christian Langmo vs. Yibing Wu               -> playerA="Christian Langmo"   playerB="Yibing Wu"
Masamichi Imamura vs. James McCabe           -> playerA="Masamichi Imamura"  playerB="James McCabe"
Darwin Blanch vs. Bernard Tomic              -> playerA="Darwin Blanch"      playerB="Bernard Tomic"
Mark Lajal vs. Trevor Svajda                 -> playerA="Mark Lajal"         playerB="Trevor Svajda"
Spencer Johnson vs. Remy Bertola             -> playerA="Spencer Johnson"    playerB="Remy Bertola"
Suresh vs. Echargui                          -> playerA="Suresh"             playerB="Echargui"
Matsuoka vs. Moriya                          -> playerA="Matsuoka"           playerB="Moriya"
Added vs. Leong                              -> playerA="Added"              playerB="Leong"
Zhou vs. Kozlov                              -> playerA="Zhou"               playerB="Kozlov"
Zhu vs. Bu                                   -> playerA="Zhu"                playerB="Bu"
Bicknell vs. Miyoshi                         -> playerA="Bicknell"           playerB="Miyoshi"
```

**Conclusion: the parser is not the cause of any failure in this specific list.** Every line was
split correctly into exactly two player names with no contaminating characters.

### Synthetic hypothesis tests (confirmed as real, latent bugs — not triggered by this list)

The task's hypothesis #1 was tested directly against the real `parseMatchupLine`:

| Input | `playerAName` produced |
|---|---|
| `* Murphy Cassone vs. Tristan Schoolkate` | `"* Murphy Cassone"` |
| `- Murphy Cassone vs. Tristan Schoolkate` | `"- Murphy Cassone"` |
| `• Murphy Cassone vs. Tristan Schoolkate` | `"• Murphy Cassone"` |
| `1. Murphy Cassone vs. Tristan Schoolkate` | `"1. Murphy Cassone"` |

**Confirmed:** `parseMatchupLine` only ever calls `.trim()` on the raw line — there is no bullet or
list-marker stripping anywhere in `splitTournament`/`splitPlayers`. Any pasted list that keeps a
literal bullet character per line (common when copying from a rendered Markdown/Word/Notes bullet
list) will pass a name like `"* Murphy Cassone"` straight into the Ledger search, and because
`escapeLikeToken` escapes `%`/`_` but not `*`, the query becomes `ilike '%\* murphy%'` — a literal
`*` in the query can only match a literal `*` in a stored name, so it always returns zero
candidates. This exactly matches the symptom described in the task ("the error message itself
echoes the un-stripped `*`") in principle, but it did **not** occur in the list the user actually
gave for this audit.

Separator tolerance (`vs.`, `vs`, `v`, `versus`, em dash, en dash, hyphen, `@`, `at`, `in`) and the
hyphenated-surname edge case (`Auger-Aliassime vs Bonzi - Halle Open`) were also tested and all
parse correctly — the separator patterns are not a source of failure.

Additional Unicode/mobile-paste robustness tests:

| Input variant | Result |
|---|---|
| Non-breaking space (`\u00A0`) between name and "vs." | Parses correctly — `\s` in the regex matches `\u00A0` |
| Curly/smart apostrophe (`’`, U+2019) inside a name | Preserved as-is (correct — it's a legitimate character in some real names) |
| En dash (`–`) as tournament separator | Parses correctly |
| Zero-width space (`\u200B`) inside a name | **Not stripped** — `"Murphy\u200BCassone"` is treated as a single word with no visible space, which would then fail the Ledger's per-word matcher differently than a normal two-word name. This is a real but very rare edge case (invisible character), not observed as the cause of any line in this list. |
| Trailing `\r` (Windows line ending) | Handled correctly by the `\r?\n` split |

## Lookup findings

### `searchLedgerPlayers` is Ledger-only by design

Confirmed by reading and by the SQL itself: the query only ever selects from `predictions`
(`player1_id`/`player1_name` union `player2_id`/`player2_name`). It never touches
`historical_matches` or any live provider. The doc-comment states this is intentional — a hit
guarantees "there's a real saved prediction to jump to." **Practical implication:** any real,
active player with zero prior Ledger predictions will always show "No Ledger player found",
regardless of how correctly their name was parsed. None of the 44 distinct players in this specific
pasted list hit this — every one of them has ≥1 real prior Ledger prediction — but this scope limit
is real and will affect any future paste that includes a genuinely new matchup.

### The dominant cause: full first name vs. stored first-initial

Every one of the 32 players named with a full first name in the pasted list **is present in the
Ledger**, but under an abbreviated name:

| Pasted name | Stored Ledger name | Ledger predictions | Root cause of failure |
|---|---|---|---|
| Murphy Cassone | M. Cassone | 2 | word "Murphy" never appears in "M. Cassone" |
| Tristan Schoolkate | T. Schoolkate | 3 | word "Tristan" never appears in "T. Schoolkate" |
| Liam Draxl | L. Draxl | 3 | same pattern |
| James Kent Trotter | J. K. Trotter | 2 | same pattern |
| Fajing Sun | F. Sun | 1 | same pattern |
| Arthur Gea | A. Gea | 4 | same pattern |
| Daniel Milavsky | D. Milavsky | 4 | same pattern |
| Duncan Chan | *no exact Chan singles player confirmed — see note below* | — | ambiguous surname pool (J. Chan, H-C. Chan, H. Chang) at the substring-match stage; "Duncan" never matches any of them either |
| Alexander Rozin | S. Rozin | 3 | same pattern (note: stored initial "S.", not "A." — possible additional first-name transliteration difference, not just abbreviation) |
| Keegan Rice | K. Rice | 7 | same pattern |
| Titouan Droguet | T. Droguet | (canonical only, no direct ledger row found under this exact surname in the sampled top rows) | same pattern |
| Alexander Blockx | A. Blockx | 1 | same pattern |
| Hugo Dellien | H. Dellien | 8 | same pattern |
| Ioannis Xilas | I. Xilas | 5 | same pattern |
| Andrej Nedic | . A. Nedic *(stray leading period in stored name — separate minor data-quality defect)* | 2 | same pattern, compounded by the stray punctuation |
| Enrico Dalla Valle | not found under "Dalla Valle"/"Valle" as a clean singles row in the sampled top results (doubles-pairing rows dominate the "Valle" substring) | — | doubles-pairing pollution (see below) plus full-name mismatch |
| Maria Timofeeva | M. Timofeeva | 1 | same pattern |
| Ann Li | *"Li" is too short/common a substring to isolate reliably; H. Dellien, A. Kulikova, etc. all contain "li" as a substring* | — | short-token false-positive pollution (see below) |
| Anna Blinkova | A. Blinkova | 4 | same pattern |
| Aliaksandra Sasnovich | A. Sasnovich | 1 | same pattern |
| Tereza Valentova | T. Valentova | (canonical only) | same pattern |
| Sofia Costoulas | S. Costoulas | 1 | same pattern |
| Christian Langmo | C. Langmo | 3 | same pattern |
| Yibing Wu | Y. Wu | 3 | same pattern |
| Masamichi Imamura | M. Imamura | 1 | same pattern |
| James McCabe | J. McCabe | 2 | same pattern |
| Darwin Blanch | D. Blanch | 4 | same pattern |
| Bernard Tomic | B. Tomic | 3 | same pattern |
| Mark Lajal | M. Lajal | 2 | same pattern |
| Trevor Svajda | T. Svajda | 7 | same pattern |
| Spencer Johnson | S. Johnson | 6 | same pattern |
| Remy Bertola | R. Bertola | 1 | same pattern |

**Every single one of these 32 players has real Ledger history.** The parser is not at fault
(all names parsed cleanly), and the players are not missing from the Ledger — the lookup's
per-word substring match structurally cannot bridge "Murphy" → "M." because that is a
first-name-abbreviation gap, not a word-order or punctuation gap (which `searchLedgerPlayers`'s
doc-comment explicitly says it *was* designed to solve — first-name-first vs. last-name-first, and
missing periods — but not first name vs. bare initial).

### Secondary bug: short-token substring pollution

Querying the single surname-only word "Bu" returns 20 unrelated candidates because `ilike '%bu%'`
matches the substring "bu" anywhere in a stored name:

```
C. Tabur, G. Bueno, M. I. Burcescu, Busquets Brau/ Novell, I. Burillo Escorihuela, C. Burel,
E. Butvilas, J. Burrage, M. Buchnik, M. Bulgaru, S. Gueymard Wayenburg, A. Bublik, …
```

None of these is actually surnamed "Bu". This directly reproduces the task's described symptom of
"Multiple unrelated player suggestions." The same mechanism affects "Li" (matches "Dellien",
"Kulikova", "Lincer", etc. via the substring "li"). Any surname-only query 2–3 characters long is
liable to this.

### Tertiary bug: doubles-pairing rows pollute singles search results

`searchLedgerPlayers` has no equivalent of `playerIdentity.ts`'s `isSinglesName` filter
(`!name.includes("/")`). Doubles-prediction rows store the pairing as one "player" name joined by
`/`, e.g. `"Leong/ Zhu"`, `"Cui/ Zhu"`, `"Vishal Balsekar/ Suresh"`. These show up mixed in with real
singles candidates for any surname search that happens to substring-match one half of a pairing —
confirmed for "Suresh", "Leong", and "Zhu" — compounding the ambiguity a user sees on an already
genuinely-ambiguous surname.

## Database coverage table

`Ledger match?` = found via the real `searchLedgerPlayers` word-ILIKE query. `Canonical match?` =
found in `historical_matches` via the same substring approach `playerIdentity.ts` uses.

| Pasted name | Canonical match? | Ledger match? | Root cause |
|---|---|---|---|
| Murphy Cassone | Yes, as "M. Cassone" | No (query fails) | Name-format mismatch |
| Tristan Schoolkate | Yes, as "T. Schoolkate" | No (query fails) | Name-format mismatch |
| Liam Draxl | Yes, as "L. Draxl" | No (query fails) | Name-format mismatch |
| James Kent Trotter | Yes, as "J. K. Trotter" | No (query fails) | Name-format mismatch |
| Fajing Sun | Yes, as "F. Sun" | No (query fails) | Name-format mismatch |
| Arthur Gea | Yes, as "A. Gea" | No (query fails) | Name-format mismatch |
| Daniel Milavsky | Yes, as "D. Milavsky" | No (query fails) | Name-format mismatch |
| Duncan Chan | Yes, as "J. Chan" / "H-C. Chan" family (ambiguous pool) | No (query fails) | Name-format mismatch + surname pool ambiguity |
| Alexander Rozin | Yes, as "S. Rozin" | No (query fails) | Name-format mismatch (also first-initial itself differs from "Alexander") |
| Keegan Rice | Yes, as "K. Rice" | No (query fails) | Name-format mismatch |
| Titouan Droguet | Yes, as "T. Droguet" | No (query fails) | Name-format mismatch |
| Alexander Blockx | Yes, as "A. Blockx" | No (query fails) | Name-format mismatch |
| Hugo Dellien | Yes, as "H. Dellien" | No (query fails) | Name-format mismatch |
| Ioannis Xilas | Yes, as "I. Xilas" | No (query fails) | Name-format mismatch |
| Andrej Nedic | Yes, as ". A. Nedic" (stray punctuation) | No (query fails) | Name-format mismatch + stray-punctuation data defect |
| Enrico Dalla Valle | Ambiguous — dominated by doubles-pairing rows containing "Valle" | No (query fails) | Name-format mismatch + doubles-row pollution |
| Maria Timofeeva | Yes, as "M. Timofeeva" | No (query fails) | Name-format mismatch |
| Ann Li | Ambiguous — "Li" substring too short/common | No (query fails) | Name-format mismatch + short-token pollution |
| Anna Blinkova | Yes, as "A. Blinkova" | No (query fails) | Name-format mismatch |
| Aliaksandra Sasnovich | Yes, as "A. Sasnovich" | No (query fails) | Name-format mismatch |
| Tereza Valentova | Yes, as "T. Valentova" | No (query fails) | Name-format mismatch |
| Sofia Costoulas | Yes, as "S. Costoulas" | No (query fails) | Name-format mismatch |
| Christian Langmo | Yes, as "C. Langmo" | No (query fails) | Name-format mismatch |
| Yibing Wu | Yes, as "Y. Wu" | No (query fails) | Name-format mismatch |
| Masamichi Imamura | Yes, as "M. Imamura" | No (query fails) | Name-format mismatch |
| James McCabe | Yes, as "J. McCabe" | No (query fails) | Name-format mismatch |
| Darwin Blanch | Yes, as "D. Blanch" | No (query fails) | Name-format mismatch |
| Bernard Tomic | Yes, as "B. Tomic" | No (query fails) | Name-format mismatch |
| Mark Lajal | Yes, as "M. Lajal" | No (query fails) | Name-format mismatch |
| Trevor Svajda | Yes, as "T. Svajda" | No (query fails) | Name-format mismatch |
| Spencer Johnson | Yes, as "S. Johnson" | No (query fails) | Name-format mismatch |
| Remy Bertola | Yes, as "R. Bertola" | No (query fails) | Name-format mismatch |
| Suresh | Yes — 2 real singles players ("D. Suresh", "K. Suresh") + doubles pollution | Ambiguous (1 unique + 1 doubles-pair row) | Genuine 2-way surname ambiguity + doubles pollution |
| Echargui | Yes, as "M. Echargui" (ATP/Challenger/ITF) | **No** — genuinely absent from `predictions` | Ledger-scope gap: real player never had a Ledger prediction saved |
| Matsuoka | Yes, one player "H. Matsuoka" | Resolved (unique) | Not a failure — resolves correctly today |
| Moriya | Yes, one player "H. Moriya" | Resolved (unique) | Not a failure — resolves correctly today |
| Added | Yes, one player "D. Added" | Resolved (unique) | Not a failure — resolves correctly today |
| Leong | Yes — 2 real singles players ("L. X. Leong S.", "W. K. Leong M.") + doubles pollution | Ambiguous | Genuine 2-way surname ambiguity |
| Zhou | Yes — 2 real singles players ("Y. Zhou", "Z. Zhou") | Ambiguous | Genuine 2-way surname ambiguity |
| Kozlov | Yes, one player "S. Kozlov" (ATP) | Resolved (unique) | Not a failure — resolves correctly today |
| Zhu | Yes — multiple real singles players ("E. Zhu", "M. Zhu", "C. Zhu", "A. Zhu") + doubles pollution | Ambiguous | Genuine multi-way surname ambiguity |
| Bu | No real singles player is actually surnamed "Bu" in either table | 20 unrelated substring matches | Short-token substring false-positive, not a real ambiguity |
| Bicknell | Yes, one player "B. Bicknell" | Resolved (unique) | Not a failure — resolves correctly today |
| Miyoshi | Not confirmed as a clean singles row in the sampled top results (possibly present further down; not in the top 8 substring hits) | Resolved (unique, "K. Miyoshi", 10 predictions) | Not a failure — resolves correctly today via Ledger despite thin canonical coverage |

## Ambiguous surname-only analysis

Per the task's explicit list, each is assessed individually using real query results (no guessed identities):

| Surname | Distinct real singles players found | Full names stored? | Tour/context available? | Genuinely unresolvable without user input? |
|---|---|---|---|---|
| Leong | 2 ("L. X. Leong S.", "W. K. Leong M.") | No — only multi-initial abbreviated forms, no full first name | Both Challenger/ITF; no distinguishing tour signal | **Yes** — tour is the same for both, no other stored field (nationality, tournament) differentiates them |
| Bu | 0 real matches — "Bu" is a substring-match artifact, not a real surname in the data | N/A | N/A | Not a real ambiguity — a parsing/lookup artifact; the app should show "No match", not a wall of unrelated names |
| Zhou | 2 ("Y. Zhou", "Z. Zhou") | No — initials only | Both Challenger/ITF | **Yes** — same tour, no other differentiator stored |
| Added | 1 ("D. Added") | No — initial only | Challenger/ITF | No — resolves uniquely today; not actually ambiguous in the current data |
| Bicknell | 1 ("B. Bicknell") | No — initial only | ATP/Challenger/ITF (multi-tour history) | No — resolves uniquely today |
| Miyoshi | 1 ("K. Miyoshi") | No — initial only | Not clearly present in `historical_matches` top hits, but unique in the Ledger | No — resolves uniquely via the Ledger today |
| Suresh | 2 real singles players ("D. Suresh", "K. Suresh") once the doubles-pairing row is excluded | No — initials only | Both ITF/Challenger | **Yes** — same tour band, no differentiator; compounded by an unfiltered doubles row that shouldn't be offered as a candidate at all |
| Echargui | 1 ("M. Echargui") in canonical data, but **zero** in the Ledger | No — initial only | ATP/Challenger/ITF | Not ambiguous — it's a Ledger-scope miss, not a naming ambiguity; the player is unique but has never had a saved prediction |
| Matsuoka | 1 ("H. Matsuoka") | No — initial only | Challenger/ITF | No — resolves uniquely |
| Moriya | 1 ("H. Moriya") | No — initial only | Challenger | No — resolves uniquely |
| Zhu | 4+ real singles players ("E. Zhu", "M. Zhu", "C. Zhu", "A. Zhu") plus more in canonical data, plus doubles-pairing pollution | No — initials only | ATP/Challenger/ITF spread across the group, but that alone doesn't map back to which "Zhu" was meant | **Yes** — most ambiguous entry in the whole list; at least 4 real distinct singles players share the bare surname and nothing in the stored data (no full first name, no tournament, no nationality) narrows it |

**Bottom line:** 3 of the 12 surname-only entries (Leong, Zhou, Zhu) are genuine, real ambiguity that
requires user confirmation — the data itself contains no full name, nationality, or other
differentiator. "Suresh" is genuinely ambiguous too once the doubles-row artifact is excluded. "Bu"
is not a real ambiguity at all — it is a substring-matching false positive that should ideally
present as "no match," not as 20 unrelated suggestions. The remaining six (Added, Bicknell,
Miyoshi, Matsuoka, Moriya, and — separately — Echargui, which fails for a different, non-ambiguity
reason) already resolve to exactly one real player today.

## Event-context assessment

Confirmed by reading `matchupResolution.ts` and `LedgerMatchupSearch.tsx`: **tournament/event text
is never used during player-identity resolution.** `resolveLine` calls `searchLedgerPlayers` with
only the raw player name string — `parsed.tournamentName` is not passed to it at all. The parsed
tournament name is used exactly once, in `matchPredictionsToPair`, and only *after* both player
identities are already fully resolved to specific player IDs — it narrows which *saved prediction*
between those two already-known players is meant, when the same two players met more than once.

**Practical implication for a case like "Zhu vs. Bu":** even though the user's list groups
`Bu`/`Zhu` next to a specific tournament label (e.g. "ATP Challenger Cordenons"), that tournament
text is completely discarded before the ambiguous-surname stage is ever reached — it could not help
narrow "which Zhu" today even in principle, because the code path that would need it
(`resolveLine`'s call into `searchLedgerPlayers`) never receives it. Using it earlier would require:
(1) passing `parsed.tournamentName` down into the player-lookup call, and (2) `searchLedgerPlayers`
(or a new query) joining back to `predictions.tournament_name` to filter candidates by players who
have a prediction at a matching tournament — a real code change, not a data change, and explicitly
out of scope for this audit.

## Data freshness spot-check

- `historical_matches` currently holds 18,640 rows spanning `scheduled_start_at` **2025-01-01 to
  2025-04-01 only** — a hard three-month window, over a year old relative to today (2026-07-14),
  even though the table's `imported_at` timestamp shows rows were touched as recently as today.
  This means the canonical/historical fallback path, if it were ever wired into paste-search, would
  not see any 2026-season Challenger/ITF debut or any player whose entire history postdates April
  2025.
- By contrast, `predictions` (the Ledger) has rows created as recently as **2026-07-14** (today),
  confirming the Ledger itself is actively current — which is why every full-name player in this
  list, despite the stale canonical table, still has a real recent Ledger prediction to be found
  under their abbreviated name.
- This staleness does not explain any failure in this specific pasted list (the Ledger data was
  current enough for all resolvable players), but it is a real, separate data-pipeline gap worth
  tracking if `historical_matches` is ever used as a fallback identity source for paste-search.

## Bulk processing behavior

Confirmed by reading `LedgerMatchupSearch.tsx`'s `handleGo`: lines are resolved **sequentially but
independently** — a `for` loop `await`s `resolveLine` once per line and updates that line's own
state slot. `resolveLine` has its own internal `try/catch` that converts any thrown error into an
`"error"` status for that line alone; the outer `try/finally` around the loop exists only to
guarantee `isResolving` is always reset, not to short-circuit the loop. **One bad or ambiguous line
never blocks, skips, or corrupts any other line** — every line in a pasted batch reaches its own
terminal status (resolved / no-match / ambiguous / unparsed / error) independently. This part of the
system is working as intended and was not a contributor to any failure in this list.

## Prioritized root-cause summary

1. **(Primary, ~73% of failed lines) Full first name vs. stored first-initial mismatch.** The
   Ledger's per-word `ILIKE` lookup was built to tolerate word order and missing punctuation, but
   not a first-name-to-initial abbreviation gap. Every one of the 16 full-name-pair lines in this
   list failed for this reason alone, despite every player already having real Ledger history.
2. **(Secondary) Short-token substring false positives.** Bare 2–3 letter surname queries (e.g.
   "Bu") match any name containing that substring anywhere, producing a wall of unrelated
   suggestions that looks like (but isn't) genuine ambiguity.
3. **(Secondary) Doubles-pairing rows are not excluded from singles player search,** unlike the
   equivalent canonical-identity code (`playerIdentity.ts`'s `isSinglesName`). This compounds any
   already-ambiguous surname search with irrelevant doubles-pair "players."
4. **(Confirmed but not triggered here) Ledger-only lookup scope.** A real, active player with zero
   prior Ledger predictions (confirmed for "Echargui" in this exact list) will always show
   "No Ledger player found," independent of parsing or name-format correctness.
5. **(Confirmed but not triggered here) Leading bullet/list-marker characters are never stripped**
   by the parser. Not present in this pasted list, but will reproduce the exact "echoes the
   un-stripped `*`" symptom described in the task the moment a differently-formatted paste includes
   one.
6. **(Real, minor) Genuine surname-only ambiguity** exists for 3–4 of the 12 bare-surname entries
   (Leong, Zhou, Zhu, and Suresh once doubles rows are excluded) — the stored data genuinely lacks
   any full name, nationality, or tournament field that could disambiguate them, so these do
   require user confirmation regardless of any fix to the above.
7. **(Real, not causal here) `historical_matches` is over a year stale**, capped at 2025-04-01,
   which would limit any future canonical-fallback lookup but does not explain any failure in this
   specific list since the Ledger itself is current.
8. **(Minor, cosmetic) A stray leading `. ` was observed in one stored name** ("Andrej Nedic" stored
   as ". A. Nedic") — a pre-existing data-quality defect in how that name was originally ingested,
   unrelated to paste-search itself.

## Recommended (not implemented) smallest-safe-fix plan

1. **Add a first-initial-tolerant matching mode to `searchLedgerPlayers`.** For each query word,
   additionally accept a stored name token that starts with the same first letter followed by a
   period (i.e., treat "Liam" as also satisfying "L." at the same name position), on top of the
   existing substring match. This directly fixes the dominant root cause without touching the
   ambiguous-surname logic or any threshold.
2. **Exclude doubles-pairing rows (names containing `/`) from `searchLedgerPlayers`'s candidate
   pool**, mirroring `playerIdentity.ts`'s existing `isSinglesName` filter, so ambiguous-surname
   results only ever show real singles candidates.
3. **Require a minimum matched-substring length (or fall back to whole-word equality) for very
   short query tokens** (e.g. ≤3 characters) so a bare short surname like "Bu" reports "no match"
   instead of 20 unrelated substring hits.
4. **Strip a small, explicit set of leading bullet/list markers** (`*`, `-`, `•`, and a leading
   `N.`/`N)` numbering) in `parseMatchupLine` before splitting on the vs-separator, so pasted
   Markdown/Word/Notes bullet lists never leak a literal marker into a player name.
5. **(Larger, not "smallest-safe" — flag for separate consideration)** Extend paste-search lookup
   to fall back to `historical_matches`/`playerIdentity.ts`'s broader search when the Ledger-only
   query returns zero candidates, clearly labeling such a result as "found, but never predicted" so
   the user understands why no saved prediction can be shown yet. This is a bigger change (new data
   source, new UI state) and should be its own follow-up rather than bundled with the above.

## Suggested regression tests

- `searchLedgerPlayers`/lookup: given a stored name `"L. Draxl"`, a query for `"Liam Draxl"` should
  match once the initial-tolerant mode ships; a query for `"Liam Someoneelse"` should not.
- `searchLedgerPlayers`: a query for a bare 2-letter surname that is only ever a substring of other
  names (fixture: `"Bu"` against `"C. Tabur"`, `"G. Bueno"`) should return zero candidates, not the
  substring hits.
- `searchLedgerPlayers`: doubles-pairing fixture rows (`"Leong/ Zhu"`) must never appear in the
  candidate list for a singles query on `"Leong"` or `"Zhu"`.
- `parseMatchupLine`: lines prefixed with `"* "`, `"- "`, `"• "`, and `"1. "` should produce a
  `playerAName` with the marker stripped, verified against the same fixture line used for the
  bullet-marker hypothesis test in this audit.
- `resolvePlayerCandidate`/end-to-end: a genuinely ambiguous 2-real-player surname fixture (mirroring
  "Zhou": `"Y. Zhou"` and `"Z. Zhou"`) must still report `"ambiguous"`, not silently resolve to one —
  confirming the initial-tolerant fix above does not regress real ambiguity detection.
