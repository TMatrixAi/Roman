---
name: Tie-break cascade underperformance
description: The tennis prediction engine's tie-break cascade (predictionEngine/tieBreakers.ts) was measured against real graded outcomes for the first time in Task #162's audit -- it makes predictions worse, not better, whenever it actually decides a pick.
---

## The rule

Never assume a tie-break/fallback heuristic that "picks a modest lean instead of an honest 50/50"
is safe just because it sounds conservative. Measure it against real graded outcomes before
trusting it.

**Why:** Querying `evaluation_predictions` by whether the tie-break cascade applied and which step
decided it showed: baseline (cascade not applied) 66.7% accuracy vs. 53.7% (Serve & Return-decided),
46.7% (Surface Elo-decided, worse than a coin flip), 42.9% (Recent Form-decided). 38% of all
validation predictions (1,509/3,987) go through this cascade. A named, confident-sounding "lean"
that underperforms a coin flip is worse for user trust than an honest 50/50, because it reads as
more reliable than it is.

**How to apply:** Any module that exists specifically to break ties/handle low-signal cases (not
just the main ensemble path) needs its own accuracy validation, separate from the main model's
overall accuracy numbers -- a good overall accuracy can hide a subset mechanism that's actively
harmful. See Task #163 for the tracked fix; the full breakdown and reproduction query are in
`artifacts/api-server/docs/audit-task162-full-prediction-accuracy-audit.md`, §2.

## Current fix state

The active implementation in `predictionEngine/tieBreakers.ts` already follows the intended
Task #162 remediation: when the raw ensemble sits within the `TIE_BAND` of 50, the function
returns `applied: true` with an honest close-match note, but it preserves the raw probability
and sets `direction: 0` / `decidingStep: null` so no directional pick is forced. The cascade is
kept as diagnostic output only; it no longer nudges the final winner in the low-confidence
regime that was shown to underperform a coin flip.

Verified locally with:
- `pnpm exec tsx --test src/services/predictionEngine/tieBreakers.test.ts src/services/predictionEngine/recommendation.test.ts`
- Result: 48 tests passed, 0 failed.
