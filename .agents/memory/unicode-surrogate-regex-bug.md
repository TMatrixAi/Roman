---
name: Unicode surrogate regex bug in OCR stripper
description: \uXXXX notation only supports 4 hex digits; 5-digit code points (emoji, supplementary plane) silently break character class ranges and can wipe all ASCII text.
---

## The rule
Never use `\uXXXX` (4-digit `\u` notation) for Unicode code points above U+FFFF inside a regex character class. Use `\u{XXXXX}` (curly-brace notation, requires the `u` flag) instead, or simply omit the supplementary range and let `normalizeName()` strip the noise downstream.

## Why
In a character class `[\u1F000-\u1FFFF]`:
- `\u1F000` without curly braces = `\u1F00` (4 hex digits: 1,F,0,0) + literal `"0"`.
- The character class range therefore spans from `"0"` (U+0030) to U+1FFF — a range that **covers every printable ASCII character**.
- With or without the `u` flag, every letter in a plain ASCII name like "Paula Badosa" matches, gets replaced with spaces, and `.trim()` yields `""`.
- The symptom is every name resolving to the full standings list (because `searchKnownPlayers(provider, "")` matches everything), then `isConfidentMatch("", cn)` returns `false` for all candidates → `player: null` for everyone.

## How to apply
- Any regex touching emoji or supplementary-plane symbols must use `\u{1F000}` notation (curly braces) AND the `u` flag, or just skip the supplementary range entirely.
- When debugging "resolver returns null for everything despite correct logic", check whether `stripOcrMetadata` is stripping the whole name — test it directly in Node before investigating match logic.
- Confirmed fix: remove the `\u1F000-\u1FFFF` range from the emoji character class in `stripOcrMetadata`; `normalizeName()` handles any remaining noise.
