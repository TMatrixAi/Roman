/**
 * Recalibrated model-disagreement scoring (2026-07-13 disagreement/upset-risk spec, Part A).
 *
 * Replaces the old raw max-min spread (which counted every model equally, so a single
 * low-reliability secondary module -- or even a fringe blend stage -- could single-handedly push
 * a match into "High Disagreement" even when the validated core signals agreed) with a weighted
 * standard deviation over each model's EXISTING effective ensemble weight
 * (`weightUsed` = reliability x its `ENSEMBLE_WEIGHT_PRIOR`, already normalized to sum to 1 by
 * `buildEnsemble` -- see dataQuality.ts). No new walk-forward/Brier/ECE tracking is invented here;
 * "validation reliability" is exactly the reliability score + prior the engine already computes.
 */

export type ModelAgreement = "Strong" | "Moderate" | "Mixed" | "HighDisagreement";

export const AGREEMENT_ORDER: ModelAgreement[] = ["Strong", "Moderate", "Mixed", "HighDisagreement"];

/** The more cautious (worse) of two agreement readings -- used to fold secondary votes (general-vs-specialist, pre-simulator-vs-simulator) into the overall agreement without ever letting one good reading paper over a bad one. */
export function worseAgreement(a: ModelAgreement, b: ModelAgreement): ModelAgreement {
  return AGREEMENT_ORDER.indexOf(a) >= AGREEMENT_ORDER.indexOf(b) ? a : b;
}

/**
 * The three feature modules the 2026-07-13 ablation report validated as the engine's real
 * predictive signal (see `ENSEMBLE_WEIGHT_PRIOR` in dataQuality.ts). These are the only models
 * whose own directional conflict, by itself, is allowed to push disagreement all the way to
 * HighDisagreement (spec Part A.C: "prioritize the validated core models").
 */
export const CORE_MODEL_NAMES = new Set(["Surface Elo", "Serve & Return", "Recent Form"]);

/**
 * A model needs at least this share of the vote's total effective weight before it counts as a
 * real, opinionated voice for the direction-conflict check or the disagreement explanation. Below
 * this floor a model can still nudge the weighted mean/stddev a little, but can never by itself
 * flip the category or headline the explanation -- this is what stops a reliability-5 or
 * weight-0.01 module from manufacturing a HighDisagreement reading alone (spec Part A.B/A.C).
 */
const MEANINGFUL_WEIGHT_SHARE = 0.15;

export interface DisagreementModelInput {
  modelName: string;
  player1Probability: number;
  weightUsed: number;
}

export interface WeightedDisagreement {
  modelAgreement: ModelAgreement;
  /** Weighted standard deviation (percentage points) of player1Probability across the vote. */
  weightedStdDev: number;
  /** % of the vote's total effective weight backing whichever player has the most support -- 100 means every meaningfully-weighted model points the same direction; near 50 means the vote is split. This is a DIRECTIONAL measure, not a margin-from-50 one: three models clustered at 52/53/55 for the same player score 100 here, not ~53 (spec Part A.E). */
  leadingSupportPercent: number;
  /** True only when at least two of the three validated core models each carry a meaningful weight share AND point at different players. */
  coreModelsConflict: boolean;
  /** Every model carrying a meaningful weight share, sorted by weight descending -- the models actually capable of driving the reading. Used to build the human-readable explanation. Empty when modelAgreement is "Strong". */
  conflictingModels: DisagreementModelInput[];
}

/**
 * Computes weighted mean/variance/stddev and directional support over a set of model votes,
 * using each model's own `weightUsed` as its effective weight -- no separate validation-reliability
 * tracking needs to exist; `weightUsed` already bakes in reliability x the module's fixed
 * importance prior. Intended to be called once over the core feature-module vote (Surface Elo,
 * Serve & Return, Recent Form, Fatigue, Head-to-Head -- the same set `buildEnsemble` already
 * builds), and again, separately, over any 2-model blend stage (general-vs-specialist,
 * pre-simulator-vs-simulator) that needs to fold its own reading into the overall agreement.
 */
export function computeWeightedDisagreement(models: DisagreementModelInput[]): WeightedDisagreement {
  const totalWeight = models.reduce((sum, m) => sum + m.weightUsed, 0) || 1;

  const weightedMean = models.reduce((sum, m) => sum + m.player1Probability * m.weightUsed, 0) / totalWeight;
  const weightedVariance = models.reduce((sum, m) => sum + m.weightUsed * (m.player1Probability - weightedMean) ** 2, 0) / totalWeight;
  const weightedStdDev = Math.sqrt(weightedVariance);

  const player1Support = models.filter((m) => m.player1Probability >= 50).reduce((sum, m) => sum + m.weightUsed, 0);
  const player2Support = totalWeight - player1Support;
  const leadingSupportPercent = (Math.max(player1Support, player2Support) / totalWeight) * 100;

  const meaningfulModels = models.filter((m) => m.weightUsed / totalWeight >= MEANINGFUL_WEIGHT_SHARE);
  const meaningfulCoreModels = meaningfulModels.filter((m) => CORE_MODEL_NAMES.has(m.modelName));
  const coreModelsConflict =
    meaningfulCoreModels.some((m) => m.player1Probability >= 50) && meaningfulCoreModels.some((m) => m.player1Probability < 50);

  // Thresholds derived from spec Part A.D's starting categories (weighted stddev <6/6-11/>11,
  // effective support >=70/58-70/<58), split into four bands so the existing Strong/Moderate/
  // Mixed/HighDisagreement scale (used across upsetRisk.ts, recommendation.ts, and the UI) keeps
  // its granularity rather than collapsing to the spec's 3 buckets.
  let modelAgreement: ModelAgreement;
  if (coreModelsConflict || weightedStdDev > 11 || leadingSupportPercent < 58) {
    modelAgreement = "HighDisagreement";
  } else if (weightedStdDev > 9 || leadingSupportPercent < 65) {
    modelAgreement = "Mixed";
  } else if (weightedStdDev > 6 || leadingSupportPercent < 75) {
    modelAgreement = "Moderate";
  } else {
    modelAgreement = "Strong";
  }

  const conflictingModels = modelAgreement === "Strong" ? [] : meaningfulModels.slice().sort((a, b) => b.weightUsed - a.weightUsed);

  return {
    modelAgreement,
    weightedStdDev: Math.round(weightedStdDev * 10) / 10,
    leadingSupportPercent: Math.round(leadingSupportPercent * 10) / 10,
    coreModelsConflict,
    conflictingModels,
  };
}

/** How near the FINAL probability sits to a coin flip -- deliberately independent of modelAgreement above. A match can be close (near 50/50) while every model agrees on direction (low disagreement, spec Part A.E), or genuinely disagree while the blended probability lands well away from 50. */
export type MatchupCloseness = "VeryClose" | "Close" | "Moderate" | "Clear";

export function computeMatchupCloseness(finalProbability: number): MatchupCloseness {
  const margin = Math.abs(finalProbability - 50);
  return margin < 5 ? "VeryClose" : margin < 15 ? "Close" : margin < 30 ? "Moderate" : "Clear";
}

/**
 * Human-readable explanation naming the actual conflicting models, their probabilities, and their
 * weights (spec Part A.F: "do not show High Disagreement without identifying the actual
 * conflict"). Null exactly when modelAgreement is "Strong" -- there is nothing to explain.
 */
export function buildDisagreementNote(disagreement: WeightedDisagreement, player1Name: string, player2Name: string): string | null {
  if (disagreement.modelAgreement === "Strong" || disagreement.conflictingModels.length === 0) return null;

  const agreementLabel = disagreement.modelAgreement.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
  const votes = disagreement.conflictingModels
    .map((m) => {
      const favorsPlayer1 = m.player1Probability >= 50;
      const displayProbability = favorsPlayer1 ? m.player1Probability : 100 - m.player1Probability;
      return `${m.modelName} favors ${favorsPlayer1 ? player1Name : player2Name} at ${displayProbability.toFixed(0)}% (weight ${m.weightUsed.toFixed(2)})`;
    })
    .join("; ");

  return `${agreementLabel}: ${votes}. Weighted spread ${disagreement.weightedStdDev.toFixed(1)}pts across meaningfully-weighted models, ${disagreement.leadingSupportPercent.toFixed(0)}% of effective weight behind the leader.`;
}
