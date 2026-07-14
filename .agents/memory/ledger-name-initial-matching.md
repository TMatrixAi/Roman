---
name: Ledger paste-search initial-abbreviation matching
description: Why searchLedgerPlayers needs an initial-tolerant match rule on top of substring ILIKE, and its limits.
---

Stored Ledger player names abbreviate the first name to a bare initial ("L. Draxl"), but pasted
names spell it out in full ("Liam Draxl"). A per-word substring ILIKE can never bridge that gap on
its own (word-order/punctuation tolerant, but not abbreviation-tolerant).

**Fix pattern:** for each query word, OR the existing substring match with a same-first-letter
initial-token regex match (`(^|[^a-zA-Z])<firstLetter>\.`, case-insensitive `~*`), still ANDed
across words. Purely additive — never narrows what substring already found, so genuine surname
ambiguity (two real players both satisfying every word) still surfaces as multiple candidates
rather than a silent pick.

**Why:** this was task #132's audit-confirmed dominant root cause of paste-search failures
(explained ~73% of failed lines, all players had real Ledger history under the abbreviated form).

**How to apply:** if extending this further, keep the short-token substring-pollution issue (bare
2-3 letter queries matching any name containing that substring) and doubles-pairing-row pollution
(names with "/") as separate, distinct fixes — they were intentionally not bundled into this one
so the ambiguity-detection contract (report ambiguous, don't guess) stays easy to reason about.
