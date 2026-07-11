export interface ModelVote {
  modelName: string;
  player1Probability: number;
  weightUsed: number;
  reliability: number;
}

export type ModelAgreement = "Strong" | "Moderate" | "Mixed" | "HighDisagreement";

const AGREEMENT_ORDER: ModelAgreement[] = ["Strong", "Moderate", "Mixed", "HighDisagreement"];

/** Same spread->label thresholds used for the level-1 feature-module vote, reused for the level-2 general-vs-specialist vote so both agreement signals mean the same thing. */
export function agreementFromSpread(spread: number): ModelAgreement {
  return spread <= 10 ? "Strong" : spread <= 25 ? "Moderate" : spread <= 40 ? "Mixed" : "HighDisagreement";
}

/** The more cautious (worse) of two agreement readings -- used to fold the general-vs-specialist vote into the overall agreement without ever letting one good reading paper over a bad one. */
export function worseAgreement(a: ModelAgreement, b: ModelAgreement): ModelAgreement {
  return AGREEMENT_ORDER.indexOf(a) >= AGREEMENT_ORDER.indexOf(b) ? a : b;
}

/** Converts a signed edge (roughly -50..50, toward player 1) into a 0-100 win probability for player 1. */
export function edgeToProbability(edge: number): number {
  const clamped = Math.max(-50, Math.min(50, edge));
  return Math.round((1 / (1 + Math.exp(-clamped / 12))) * 1000) / 10;
}

export function buildEnsemble(
  modules: Array<{ name: string; player1Edge: number; reliability: number }>,
): { models: ModelVote[]; ensembleProbability: number; modelAgreement: ModelAgreement } {
  const models: ModelVote[] = modules.map((m) => ({
    modelName: m.name,
    player1Probability: edgeToProbability(m.player1Edge),
    weightUsed: 0, // filled in below
    reliability: m.reliability,
  }));

  const totalReliability = models.reduce((sum, m) => sum + Math.max(1, m.reliability), 0);
  for (const m of models) {
    m.weightUsed = Math.round((Math.max(1, m.reliability) / totalReliability) * 1000) / 1000;
  }

  const ensembleProbability = models.reduce((sum, m) => sum + m.player1Probability * m.weightUsed, 0);

  const spread = Math.max(...models.map((m) => m.player1Probability)) - Math.min(...models.map((m) => m.player1Probability));
  const modelAgreement = agreementFromSpread(spread);

  return { models, ensembleProbability: Math.round(ensembleProbability * 10) / 10, modelAgreement };
}
