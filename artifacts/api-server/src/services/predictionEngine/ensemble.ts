import { computeWeightedDisagreement, type ModelAgreement } from "./disagreement";

export interface ModelVote {
  modelName: string;
  player1Probability: number;
  weightUsed: number;
  reliability: number;
}

// Re-exported so existing callers (`recommendation.ts`, `upsetRisk.ts`, `index.ts`) can keep
// importing agreement-related symbols from "./ensemble" -- the actual weighted-disagreement math
// now lives in `./disagreement.ts` (see that file for the full recalibration rationale).
export type { ModelAgreement };
export { worseAgreement, AGREEMENT_ORDER } from "./disagreement";

/** Converts a signed edge (roughly -50..50, toward player 1) into a 0-100 win probability for player 1. */
export function edgeToProbability(edge: number): number {
  const clamped = Math.max(-50, Math.min(50, edge));
  return Math.round((1 / (1 + Math.exp(-clamped / 12))) * 1000) / 10;
}

export interface EnsembleModuleInput {
  name: string;
  player1Edge: number;
  reliability: number;
  /**
   * Fixed prior multiplier on this module's ensemble VOTING weight (distinct from
   * `MODULE_IMPORTANCE`, which only feeds the Data Quality score). Defaults to 1 -- a module
   * with no explicit prior gets exactly the reliability-proportional weight it always had.
   * See `ENSEMBLE_WEIGHT_PRIOR` in `dataQuality.ts` for the fix-the-engine rationale.
   */
  weightPrior?: number;
  /**
   * Post-hoc shrink (0-1) applied to how far THIS module's own displayed/voted probability sits
   * from 50, to correct a module whose stated confidence has been measured (via the ablation
   * report) to systematically overstate its real hit rate. 1 = no shrink (default). Applied to
   * the module's own vote before it enters the weighted average, so both the per-model display
   * and the blended ensemble reflect the correction consistently.
   */
  confidenceShrink?: number;
}

export function buildEnsemble(modules: EnsembleModuleInput[]): { models: ModelVote[]; ensembleProbability: number; modelAgreement: ModelAgreement } {
  const models: ModelVote[] = modules.map((m) => {
    const rawProbability = edgeToProbability(m.player1Edge);
    const shrink = m.confidenceShrink ?? 1;
    const shrunkProbability = shrink === 1 ? rawProbability : Math.round((50 + (rawProbability - 50) * shrink) * 10) / 10;
    return {
      modelName: m.name,
      player1Probability: shrunkProbability,
      weightUsed: 0, // filled in below
      reliability: m.reliability,
    };
  });

  const priors = modules.map((m) => m.weightPrior ?? 1);
  const rawWeights = models.map((m, i) => Math.max(1, m.reliability) * priors[i]);
  const totalWeight = rawWeights.reduce((sum, w) => sum + w, 0);
  models.forEach((m, i) => {
    m.weightUsed = Math.round((rawWeights[i] / totalWeight) * 1000) / 1000;
  });

  const ensembleProbability = models.reduce((sum, m) => sum + m.player1Probability * m.weightUsed, 0);

  // Recalibrated (2026-07-13 disagreement spec): weighted standard deviation + directional
  // support over each model's own effective weight, gated so a low-reliability/low-weight module
  // can't single-handedly flip the category -- see `./disagreement.ts`.
  const { modelAgreement } = computeWeightedDisagreement(models);

  return { models, ensembleProbability: Math.round(ensembleProbability * 10) / 10, modelAgreement };
}
