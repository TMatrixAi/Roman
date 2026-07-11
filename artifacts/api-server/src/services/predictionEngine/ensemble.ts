export interface ModelVote {
  modelName: string;
  player1Probability: number;
  weightUsed: number;
  reliability: number;
}

export type ModelAgreement = "Strong" | "Moderate" | "Mixed" | "HighDisagreement";

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
  const modelAgreement: ModelAgreement = spread <= 10 ? "Strong" : spread <= 25 ? "Moderate" : spread <= 40 ? "Mixed" : "HighDisagreement";

  return { models, ensembleProbability: Math.round(ensembleProbability * 10) / 10, modelAgreement };
}
