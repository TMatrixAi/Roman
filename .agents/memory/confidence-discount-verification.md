---
name: Confidence-discount fix verification
description: How to correctly re-check shrink-toward-50 calibration fixes (DQ curve, tour/surface discounts, specialist overconfidence) against fresh data.
---

A fix that only shrinks a stated probability toward 50% (a confidence/calibration correction)
cannot change raw prediction accuracy (which player was picked) except in the rare case a
probability was already hovering right at 50. Don't expect segment "accuracy" numbers to move
just because a confidence-shrink constant changed -- the right signal is the accuracy-vs-DQ (or
accuracy-vs-pool) DIRECTION/GAP within one fresh report, not a raw-number comparison against an
older report whose underlying corpus may have changed size/composition in between.

The ablation job (`POST /api/evaluation/ablation/run`) is read-only against
`evaluation_predictions`/`evaluation_runs` -- safe to re-run anytime, unlike
`runWalkForwardEvaluation` (which wipes real evaluation history, see
`walkforward-historical-scoring-perf.md`). But it holds the full historical corpus in memory for
Elo/match-history reconstruction; as the corpus grows (it grows continuously via the historical
backfill job), the in-process HTTP-triggered job can OOM the dev server at Node's default ~2GB
heap. Fixed for now via `NODE_OPTIONS=--max-old-space-size=6144` in the `development` env
(`.replit` `[userenv.development]`) -- re-raise further if the corpus keeps growing and it OOMs
again.

Any "Active Segment Specialist" fix (in `specialistWeights.ts`) is unverifiable via ablation/live
data whenever `specialist_models` has zero rows -- check `select count(*) from specialist_models`
before trusting a specialist-related ablation diagnostic; `n: 0` in every `segmentSpecialist`
diagnostic bucket confirms it never voted. Only a walk-forward run populates that table, which is
blocked on Task #135 (walk-forward wipes real eval history) being fixed first -- don't run
walk-forward blind just to unblock one verification.
