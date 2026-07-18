---
name: Screenshot player resolution — abbreviated names
description: Why full-name OCR reads like "Paula Badosa" fail to resolve against DB entries like "P. Badosa", and the two-part fix.
---

## Problem

The historical_matches table stores player names in abbreviated form ("P. Badosa", "M. Sherif",
"T. Zidansek", "O. Oliynykova"). Screenshots OCR'd by Gemini return the full formal name.

Two independent failures:

1. **LIKE search miss**: `searchKnownPlayers("Paula Badosa")` runs `WHERE name LIKE '%paula badosa%'`,
   which doesn't match "p. badosa" — the full name is never a substring of the abbreviated form.

2. **isConfidentMatch miss**: even if the abbreviated entry were returned, the original matcher
   required every recognized word to appear verbatim in the candidate. "paula" is not "p" → fail.

## Fix

### Part 1 — `gatherCandidates()` in screenshotMatchupResolver.ts
When the full-name primary search returns no confident matches, retry searching by each word of the
recognized name in reverse order (surname first). Stops as soon as one confident match is found.
"Paula Badosa" → tries "Badosa" → finds "P. Badosa".

### Part 2 — `isConfidentMatch()` — bidirectional with initial expansion
Two match directions, both using `wordsMatch(a, b)` which treats a single-letter word as an
initial of any word starting with that letter:

- **Forward** (all recognized words match some candidate word): handles short OCR reads like
  "Alcaraz" → "Carlos Alcaraz".
- **Reverse** (all candidate words match some recognized word, when recognized is at least as long):
  handles full OCR reads against abbreviated DB entries. "P. Badosa" ← "Paula Badosa": candidate
  words ["p", "badosa"] — "p" is initial of "paula", "badosa" exact ✓.

### Ambiguity is preserved
Multiple "Sherif" entries exist. Only "M. Sherif" passes reverse-match for "Maiar Sherif Ahmed
Abdelaziz" because "R. Sherif" and "D. Sherif" have initials that don't match any recognized word.

**Why:** historical_matches (the only fallback identity source) inherits abbreviated names from the
API-Tennis raw feed; the provider has no name-search endpoint so all resolution is local.

**How to apply:** any future change to isConfidentMatch or searchKnownPlayers must keep both
directions and the initial-expansion rule, or abbreviated-name resolution silently regresses.
