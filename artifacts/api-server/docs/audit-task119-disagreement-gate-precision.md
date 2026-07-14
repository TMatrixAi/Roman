# Task #119 — Hardening Disagreement-Gate Precision: Convention Audit

**Scope:** Pin down, with exact citations, the five implicit conventions left in place by Task #114's unanimous-pick fix, and confirm `modelAgreement`/`disagreementNote` are read from a single, consistent source everywhere they're displayed. Fix anything found inconsistent.

**Result:** All five conventions checked out as consistent and correctly implemented. All display/consumption sites read from the same finalized value. **No code changes were required** — this task is a verification and documentation pass, not a bug fix.

---

## 1. The "meaningful" weight-share threshold

**Citation:** `disagreement.ts:37` — `const MEANINGFUL_WEIGHT_SHARE = 0.15;`

This is the *only* definition of this constant in the codebase. It is used exactly once, at `disagreement.ts:88`, to build `meaningfulModels` (the set of models allowed to drive the conflict gate and appear in `conflictingModels`). No shadow/duplicate constant exists elsewhere — a grep for `0.15` across `predictionEngine/` turns up only unrelated constants (`finalConsistencyCheck.ts:70`'s `PROBABILITY_EPSILON`, `styleMatchup.ts:47`'s specialist-split threshold), confirming this isn't accidentally reusing or diverging from another module's number.

**Verdict:** Consistent, single source. No fix needed.

## 2. The neutral-band rule at exactly 50%

**Citation:** `disagreement.ts:84, 90-91, 103-104` all use `player1Probability >= 50` as an exact cutoff — there is no tolerance band (e.g. no `49.5–50.5` neutral zone anywhere in the file).

This matches the engine-wide convention exactly: `eliteTier.ts:128-131`'s `voteFavorsPlayer1` uses the identical `vote.player1Probability >= 50` test. Both places treat a model reading exactly 50.0 as favoring player 1, never as "favoring neither side." This is confirmed by `disagreement.test.ts:180-193` ("all-neutral (exactly 50%) models never fabricate a leader or a manufactured conflict"), which asserts that three models all at exactly 50 land on `leadingSupportPercent: 100` (all on the same side of the `>=50` line) and `modelAgreement: "Strong"` — not some separate "undecided" state.

**Verdict:** Exact-50.0, `>=`-favors-player1 rule, consistent with `voteFavorsPlayer1` everywhere else in the engine. No deviation, no fix needed.

## 3. Duplicate model names

**Citation:** `disagreement.ts` has no deduplication logic anywhere — `computeWeightedDisagreement` iterates whatever `DisagreementModelInput[]` it's given. Two entries sharing a `modelName` are treated as **fully independent votes**: both weights count separately into the weighted mean/variance/support sums, and both would independently match `CORE_MODEL_NAMES.has(m.modelName)` if the shared name is a core name (so two same-named core entries could each need to be on either side of 50% to trigger `coreModelsConflict`, exactly as any other two-model pair would).

Checking every real call site in `index.ts` (`buildEnsemble(ensembleModuleEdges)` at line 293; the general-vs-specialist blend at line 438; the pre-simulator-vs-simulator blend at line 455): every model name pushed into any of these arrays is a distinct hardcoded string — `"Surface Elo"`, `"Serve & Return"`, `"Recent Form"`, `"Fatigue"`, `"Availability"`, `"Head-to-Head"`, `"Match Load Recovery"` (excluded from the ensemble vote but never duplicated), `"General Model"`, `` `Segment Specialist (${segment.label})` ``, `"Monte Carlo Simulator"``. None of these can collide in production — this is a purely defensive edge case, not a reachable one.

`disagreement.test.ts:221-228` already covers this (two "Surface Elo" entries) and asserts only that the result doesn't fabricate `HighDisagreement` — consistent with "independent votes, no special dedup" being the intended behavior, since a real collision can't occur anyway.

**Verdict:** Independent votes (no dedup) is the actual and intended behavior; it's unreachable via any real caller today. No fix needed — documenting this here so a future change that *could* introduce duplicate names (e.g. two segment specialists) knows to check this assumption first.

## 4. Non-summing weights

**Citation:** `disagreement.ts:67, 80-88` — `computeWeightedDisagreement` never renormalizes the input weights to sum to 1. Instead, every calculation is expressed as a ratio against `totalWeightRaw` (the sum of whatever weights were actually passed): weighted mean divides by `totalWeight`, weighted variance divides by `totalWeight`, and the meaningful-weight-share filter is `m.weightUsed / totalWeight >= MEANINGFUL_WEIGHT_SHARE`.

Because every quantity that matters (mean, variance/stddev, support-%, meaningful-share) is a ratio against the models' own total, the function is **mathematically scale-invariant**: multiplying every input weight by the same constant changes nothing about the output category, spread, or support percentage. This is confirmed by `disagreement.test.ts:212-219` (weights `12` and `9`, nowhere near summing to 1) asserting normal, non-`HighDisagreement` behavior.

In practice, every real caller already passes weights that *do* sum to 1: `ensemble.ts:56-61` explicitly normalizes `rawWeights[i] / totalWeight` before ever calling `computeWeightedDisagreement`, and both two-model blends in `index.ts` (general-vs-specialist at line 439-440, pre-simulator-vs-simulator at line 456-457) use complementary weights (`1 - x` and `x`) that sum to 1 by construction. This matters for one reason beyond the category math: `buildDisagreementNote` (`disagreement.ts:159`) prints the raw `weightUsed` value in its human-readable explanation ("weight 0.34") — that number is only a meaningful *share* because real callers guarantee normalized input. The function itself doesn't need to renormalize to be correct, but the display text implicitly relies on normalized input already being the norm.

**Verdict:** Weights are used as-is (relative shares via division by the passed-in total), which is the correct and by-design choice since the math is scale-invariant. Real callers already normalize, so there's no discrepancy between intended and actual behavior. No fix needed.

## 5. The zero-weight / empty-model-array fallback

**Citation:** `disagreement.ts:75-77`:
```ts
if (models.length === 0 || totalWeightRaw === 0) {
  return { modelAgreement: "Strong", weightedStdDev: 0, leadingSupportPercent: 50, coreModelsConflict: false, conflictingModels: [] };
}
```
This falls into the **existing** `"Strong"` category (no new category invented, no crash, no fabricated leader) — a deliberate fix for a specific prior bug, documented in the comment directly above it: the old `|| 1` fallback combined with `player2Support = totalWeight - player1Support` used to fabricate 100% support for player 2 out of a genuinely empty input.

`disagreement.test.ts:195-210` covers both sub-cases (a fully empty array, and a non-empty array where every weight is exactly 0) and asserts `modelAgreement: "Strong"`, `leadingSupportPercent: 50`.

**Verdict:** Confirmed correct, matches its own documented intent, uses only the pre-existing `ModelAgreement` enum. No fix needed.

---

## Display-site trace: is `modelAgreement`/`disagreementNote` read from one consistent source?

Traced every reader in the codebase (excluding one-off diagnostic/backfill scripts, which are explicitly out of scope per this task and tracked separately under #118):

1. **Computed once, per prediction, in `index.ts`.** `modelAgreement` starts as `featureAgreement` (from `buildEnsemble`, line 293) and is only ever *widened* — never recomputed from scratch — via `worseAgreement` when the general-vs-specialist blend (line 445) or pre-simulator-vs-simulator blend (line 462) produces a worse reading. `disagreementNote` is computed exactly once, at line 465, from the single `governingDisagreement` value that tracks whichever of those three readings was worst. Both are then threaded as plain function parameters into every downstream consumer in the same call — `computeUpsetRisk` (line 529), `computeRecommendation` (line 536), `computeEliteTier` (line 611), `checkFinalConsistency` (line 639, 644) — none of which recompute disagreement independently; they all take `modelAgreement`/`disagreementNote`/`disagreement` as inputs. Confirmed via direct grep: `upsetRisk.ts`, `eliteTier.ts`, `recommendation.ts`, and `finalConsistencyCheck.ts` only ever *receive* these values as typed parameters, never call `computeWeightedDisagreement` or `buildDisagreementNote` themselves.
2. **Stored once, as part of `engine`.** `index.ts:661-700` places the exact same `modelAgreement`/`disagreementNote` values into the returned `EngineBreakdown`. `routes/predictions.ts:228` persists `engine: output.engine` verbatim to the database at creation time — no field is recomputed or reshaped on the way in.
3. **Evaluation/backtest writers all read from the same finalized object.** `paperTrading.ts:223`, `historicalScoring.ts:126`, and `eliteTierBacktest.ts:65` all pull `output.engine.modelAgreement` directly from the `EngineOutput` returned by the one call to `runPredictionEngine` for that row — not a separate computation. `metrics.ts:212-215` reads the already-stored `modelAgreement` DB column for aggregate accuracy-by-agreement-tier reporting.
4. **API read path returns the stored blob unchanged.** `routes/predictions.ts:257` (`GetPredictionResponse.parse(row)`) parses and returns the persisted row as-is; there is no recomputation on GET.
5. **Frontend reads directly from the API response.** `PredictionResult.tsx:93` — `const engine = prediction.engine` — then displays `engine.modelAgreement` (line 262-263) and `engine.disagreementNote` (line 274-276) straight from that object. This is the only frontend component referencing either field; no other UI component reads or recomputes them.

**Verdict:** Single source of truth end-to-end — computed once per prediction in `index.ts`, persisted verbatim, and read verbatim everywhere else (evaluation writers, API, UI). No place was found reading a stale, re-derived, or different-shape copy. No fix needed.

---

## Test coverage

The edge cases named in this task's scope (neutral-band, duplicate model names, non-summing weights, zero-weight/empty fallback) were already covered by `disagreement.test.ts` prior to this task (added alongside the Task #114 fix) — see lines 163-229. No new tests were needed; the full suite (196 tests across `predictionEngine/`) passes unchanged.

## Summary

| Convention | Value / Location | Consistent with rest of engine? | Fix needed? |
|---|---|---|---|
| Meaningful weight-share floor | `MEANINGFUL_WEIGHT_SHARE = 0.15` (`disagreement.ts:37`) | Yes — sole definition, used once | No |
| Neutral-band rule | Exact `>= 50` (no tolerance band), matches `voteFavorsPlayer1` | Yes | No |
| Duplicate model names | Independent votes, no dedup; unreachable via real callers | Yes (by design + unreachable) | No |
| Non-summing weights | Used as relative shares (ratio-based, scale-invariant); real callers always normalize anyway | Yes | No |
| Zero-weight/empty fallback | Falls into existing `"Strong"` category | Yes | No |
| `modelAgreement`/`disagreementNote` display consistency | Single computation in `index.ts`, persisted verbatim, read verbatim everywhere | Yes | No |

No code, threshold, or category changes were made as part of this task.
