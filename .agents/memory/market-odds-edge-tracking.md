---
name: Market odds & edge tracking design
description: Pick-oriented market-edge convention, and general provider-integration lessons for real-money odds APIs.
---

## Pick-oriented edge, not player1-relative
When averaging a model-vs-market edge across many rows, orient the signed value to the model's own predicted-winner pick (`predictedWinnerProbability − impliedProbabilityForPick`), not to an arbitrary fixed side like "player1". A player1-relative signed edge averages toward zero across a random mix of predictions where player1 sometimes is and isn't the pick, destroying the signal. Keep any underlying player1-relative probability field for auditability, but derive the pick-oriented edge as a separate value.

**Why:** Discovered while designing a market-edge dashboard metric for paper-trading predictions — the naive "player1 model prob − player1 implied prob" signal is meaningless in aggregate.

**How to apply:** Any cross-side comparison metric that will be averaged across rows should be reoriented to a consistent semantic anchor (the pick, the winner, etc.), not to a positional slot that varies randomly relative to that anchor.

## Third-party odds/sports API docs diverge from real responses
Real responses from third-party odds providers have diverged meaningfully from their published docs (unexpected shapes for grouped-vs-flat sport listings, object-vs-array collections, string-vs-numeric price encoding, and error payloads that return HTTP 200 with an error body instead of a non-2xx status).

**Why:** Assuming the documented shape led to parsing code that would have silently broken against the real API.

**How to apply:** Before trusting a third-party API integration, verify parsing against a real live response, not just the documented schema — and don't assume error conditions are always signaled via HTTP status.

## Fuzzy name matching across data providers
Matching player/entity names across two independently-spelled data sources must use exact token matching (word-boundary) with a minimum-length guard on short tokens — never raw substring containment. A short surname or common token can appear as an accidental substring inside an unrelated word, causing silent false-positive matches that corrupt any metric computed from the (wrong) match.

**Why:** Substring containment on a 2-3 letter surname will match inside unrelated tokens far more often than expected; a bad player match directly poisons downstream computed metrics with no visible error.

**How to apply:** Any fuzzy identity-matching code across two provider naming conventions should tokenize both names and require exact token equality (plus a minimum trusted-length threshold) rather than `.includes()`-style containment.

## Odds fetch timing
Odds should be fetched and any edge computed only at the moment a prediction is truly locked-in (never backfilled/refreshed later), and only for genuinely live/real-time flows — not historical backtests, since no live-only odds API can honestly supply a contemporaneous historical quote for a past match.
