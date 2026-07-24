import { deriveMonteCarloHeadline } from "@/lib/monteCarloHeadline";
import { UPSET_RISK_SHORT } from "@/lib/upsetRiskColors";

const COPY_RECOMMENDATION_LABELS: Record<string, string> = {
  STRONG_RECOMMENDATION: "Strong",
  MODERATE_LEAN: "Lean",
  HIGH_RISK: "High Risk",
  NO_STRONG_SIGNAL: "No Signal",
  DO_NOT_RECOMMEND: "No Rec",
};

function getRecommendationLabel(prediction: any): string {
  const engine = prediction?.engine ?? {};
  if (engine.isEliteTier) return "Elite";

  const recommendation = String(prediction?.recommendation ?? "");
  return COPY_RECOMMENDATION_LABELS[recommendation] ?? recommendation.replace(/_/g, " ");
}

function getWinProbability(prediction: any): number | null {
  if (typeof prediction?.predictedWinnerProbability === "number") {
    return Number(prediction.predictedWinnerProbability);
  }

  if (typeof prediction?.calibratedProbability === "number") {
    return Number(prediction.calibratedProbability);
  }

  return null;
}

function formatHeadToHead(prediction: any): string {
  const headToHead = prediction?.engine?.headToHead;
  if (!headToHead || typeof headToHead.player1Wins !== "number" || typeof headToHead.player2Wins !== "number") {
    return "—";
  }

  const p1Wins = Number(headToHead.player1Wins);
  const p2Wins = Number(headToHead.player2Wins);
  return `${p1Wins}–${p2Wins}`;
}

function formatMonteCarloHeadline(prediction: any): string {
  const engine = prediction?.engine ?? {};
  const simulation = engine.simulation;
  if (
    !simulation ||
    typeof simulation.player1WinProbability !== "number" ||
    typeof prediction?.predictedWinnerId !== "string" ||
    typeof prediction?.player1Id !== "string" ||
    typeof prediction?.player2Id !== "string"
  ) {
    return "—";
  }

  const { headlineWinProbability } = deriveMonteCarloHeadline({
    predictedWinnerId: String(prediction.predictedWinnerId),
    player1Id: String(prediction.player1Id),
    player1Name: String(prediction.player1Name ?? "Player 1"),
    player2Name: String(prediction.player2Name ?? "Player 2"),
    player1WinProbability: Number(simulation.player1WinProbability),
    rangeLow: Number(simulation.rangeLow ?? simulation.player1WinProbability),
    rangeHigh: Number(simulation.rangeHigh ?? simulation.player1WinProbability),
  });

  return `${Math.round(headlineWinProbability)}%`;
}

export function buildPredictionCopyText(prediction: any): string {
  const engine = prediction?.engine ?? {};
  const recommendation = getRecommendationLabel(prediction);
  const winProbability = getWinProbability(prediction);
  const monteCarloHeadline = formatMonteCarloHeadline(prediction);
  const headToHead = formatHeadToHead(prediction);

  const lines: string[] = [];
  lines.push(`${String(prediction.predictedWinnerName ?? "Predicted Winner")} 🥇`);
  lines.push("");

  if (typeof winProbability === "number") {
    lines.push(`Win%: ${Math.round(winProbability)}%`);
  }

  if (recommendation) {
    lines.push(`Rec: ${recommendation}`);
  }

  const upsetShort = UPSET_RISK_SHORT[prediction.upsetRisk as keyof typeof UPSET_RISK_SHORT] ?? String(prediction.upsetRisk ?? "");
  if (upsetShort) lines.push(`Upset Risk: ${upsetShort}`);

  if (typeof prediction.dataQuality === "number") {
    lines.push(`Data Quality: ${Math.round(Number(prediction.dataQuality))}%`);
  }

  if (prediction.predictedSetScore) {
    lines.push(`Set: ${String(prediction.predictedSetScore)}`);
  }

  lines.push(`Monte Carlo: ${monteCarloHeadline}`);
  lines.push(`H2H: ${headToHead}`);

  lines.push("");
  lines.push("🤖 Built with Tennis Matrix AI 🤖");
  lines.push("Follow for Launch Updates");
  lines.push("𝕏: @TennisMatrixAI");
  lines.push("IG: @TennisMatrixAI");

  return lines.join("\n");
}
