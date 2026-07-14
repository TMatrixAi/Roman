# Serve & Return margin-proxy padded-array fix (Task #92)

**Date:** 2026-07-14
**Trigger:** Found while investigating Task #91's fatigue redesign.

## The bug

`MatchRecord.setGameMargins` (from `historical_matches.game_margins_player1`) is stored as a
**fixed-length 5-slot array**; unplayed trailing sets are padded with
`{playerGames: 0, opponentGames: 0}` rather than the array being trimmed to the real set count.
`.length` is therefore always 5, regardless of how many sets a match actually had.

`serveReturn.ts`'s `ratingsFromMargins` (the margin-based proxy used whenever a match lacks
provider point-level stats) had two separate problems from this:

1. Its `withMargins` filter (`m.setGameMargins.length > 0`) was a no-op — it never actually
   excluded matches with zero real set data, since length is always 5.
2. Its weighted-margin loop iterated **all 5 slots for every match**, including the padded
   zero-only ones, adding `strengthFactor` to `weightTotal` for each fake slot. For an ordinary
   2-set match this meant the denominator summed weight for 5 "sets" when only 2 were real,
   diluting every real match's average per-set margin toward 0.

`fatigue.ts` had the same `.length > 0` no-op pattern in its `p1HasGameData`/`p2HasGameData`
checks (lower-impact, since `estimatedGames`'s sum is numerically unaffected by zero-padding, but
the has-game-data flag itself was always true regardless of whether real data existed).

## Fix

Added a shared helper, `realSetGameMargins()` in `src/services/predictionEngine/setMargins.ts`,
that filters to sets with at least one game won by either side. Both `serveReturn.ts` and
`fatigue.ts` now route through it instead of reading `setGameMargins`/`.length` directly.
`matchLoadRecovery.ts` (Task #91) already had its own copy of this exact fix; it now reuses the
shared helper too, removing the duplication.

## Measured impact

A standalone, non-destructive comparison script
(`src/scripts/analyzeServeReturnMarginFix.ts`) computed the OLD (buggy) and NEW (fixed)
margin-proxy rating side by side, over every historical match where **both** players fall back to
the margin proxy (i.e. neither has enough real provider point-level stats — the only path this bug
affects; `realRatingsFromStats` was never touched by it), reconstructed with the same leak-proof
`reconstructPlayerMatchHistory` walk-forward backtests use.

- 9,448 matches use the margin-proxy path for both players.
- The fix meaningfully changes the rating gap between the two players (>0.5 points) on **92.3%**
  of those matches — this is a real, corpus-wide effect, not a rare edge case.
- **Overall win-prediction accuracy is essentially unchanged**: 57.79% (old, buggy) vs. 57.78%
  (new, fixed), n≈9,200–9,300. This makes sense: the padding-dilution factor is close to a
  constant multiplicative shrink across most matches (nearly every match's real set count is 2 or
  3, so the padding always divides by a similarly-sized denominator), so the *sign* of the
  rating gap — which is all that determines which player the module effectively picks — rarely
  flips even though the *magnitude* does.

**What this means:** the fix does not change which player Serve & Return would have picked in
most historical matches, but it does correct a real, silent shrinkage of the *magnitude* of its
rating gap for the vast majority of proxy-path matches. Magnitude matters beyond simple pick
accuracy: it affects how strongly this module's edge blends into the ensemble vote, and how the
proxy rating interacts with `blendPointLevel`'s point-level nudge and downstream calibration —
all of which use the real distance from 50, not just its sign. No live ablation re-validation is
needed before shipping this fix (directional accuracy is unaffected, so it doesn't require a
weight-retuning decision), but it is worth watching in the next scheduled calibration refit since
the module's raw edge magnitude on proxy-path matches has shifted.

## Files changed

- `src/services/predictionEngine/setMargins.ts` (new) — shared `realSetGameMargins()` helper.
- `src/services/predictionEngine/serveReturn.ts` — `ratingsFromMargins` now filters and iterates
  only real (non-padded) sets.
- `src/services/predictionEngine/fatigue.ts` — `estimatedGames`/has-game-data checks now use the
  shared helper.
- `src/services/predictionEngine/matchLoadRecovery.ts` — deduplicated to use the shared helper.
- `src/scripts/analyzeFatigueRecoveryCandidates.ts` — deduplicated to use the shared helper.
- `src/scripts/analyzeServeReturnMarginFix.ts` (new) — the before/after comparison script above.
- New regression tests in `serveReturn.test.ts` and `fatigue.test.ts` covering padded-array
  matches (both "some real sets + padding" and "only padding, no real data at all").
