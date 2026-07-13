---
name: Weighted model disagreement scoring
description: Non-obvious design choices behind the prediction engine's modelAgreement/matchupCloseness/disagreementNote fields.
---

Model disagreement categorization must gate on **meaningfully-weighted** conflicts, not raw spread across all modules.

**Why:** a low-reliability/near-zero-weight module (e.g. Fatigue with a fixed-constant reliability) can vote wildly opposite the core signal and would flip the whole category to HighDisagreement under a naive stddev-across-all-modules approach, even though it carries almost no effective weight. Real disagreement should only fire when ≥2 of the historically-validated core modules (Surface Elo, Serve & Return, Recent Form) each hold a meaningful weight share (~15%+) and point at different players.

**How to apply:** when adding new disagreement/consensus/conflict-detection logic anywhere in the prediction engine (or a similar weighted-ensemble system), always gate on a minimum weight-share threshold per contributing signal before letting it affect the category — never average/spread raw votes unweighted.

Separately: "how much models disagree" (modelAgreement) and "how close the final probability is to 50/50" (matchupCloseness) are **independent** signals and must not be conflated. A close matchup where every model agrees on direction is low disagreement, not high — nearness to 50% alone must never imply disagreement, and vice versa (models can genuinely conflict even when the blended probability lands well away from 50).
