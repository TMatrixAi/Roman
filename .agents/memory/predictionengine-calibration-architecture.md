---
name: Prediction engine stays sync; calibration/opponent-strength/weather are caller-resolved
description: Why runPredictionEngine (artifacts/api-server predictionEngine) takes pre-fetched plain data instead of doing its own DB/network calls, and how calibration is unified across live + paper-trading call sites.
---

`runPredictionEngine` (predictionEngine/index.ts) is deliberately kept synchronous and free of DB/network access. Any data that requires an async lookup -- real opponent Elo history, the active Phase 4 isotonic calibration mapping, upcoming-fixture weather -- is resolved by the caller (`routes/predictions.ts`, `evaluation/paperTrading.ts`) and passed into `PredictionEngineInput` as plain pre-fetched data (maps/arrays/null).

**Why:** keeps the engine trivially unit-testable and swappable without touching its call sites' async plumbing; also means both live predictions and paper trading can share one calibration code path instead of paper trading applying calibration post-hoc while live predictions skipped it entirely (which was the pre-Phase-5 bug).

**How to apply:** when adding a new engine input that needs a DB/network round trip, add it as an optional field on `PredictionEngineInput`, resolve it in both `routes/predictions.ts` and `evaluation/paperTrading.ts` (or explicitly justify why one caller doesn't have the data, e.g. live prediction requests have no scheduled date so weather is always null there), and never fetch it inside `predictionEngine/*.ts` modules.

Related: opponent Elo is never defaulted to a league-average when unknown -- it's `undefined`/absent and every module falls back to its pre-Phase-5 opponent-neutral behavior, with an explicit `warnings[]` entry noting reduced confidence. This "absent, not faked" pattern applies to weather (null when venue/date unresolved) and calibration (heuristic fallback only when no fitted model exists yet) too.
