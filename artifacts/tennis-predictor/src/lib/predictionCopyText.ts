import { deriveMonteCarloHeadline } from "@/lib/monteCarloHeadline";
import { UPSET_RISK_SHORT } from "@/lib/upsetRiskColors";

const COPY_RECOMMENDATION_LABELS: Record<string, string> = {
  STRONG_RECOMMENDATION: "Strong Recommendation",
  MODERATE_LEAN: "Moderate Lean",
  HIGH_RISK: "High Risk",
  NO_STRONG_SIGNAL: "No Strong Signal",
  DO_NOT_RECOMMEND: "Do Not Recommend",
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
    return "0–0 (tied)";
  }

  const p1Wins = Number(headToHead.player1Wins);
  const p2Wins = Number(headToHead.player2Wins);
  if (p1Wins === p2Wins) {
    return `${p1Wins}–${p2Wins} (tied)`;
  }

  const leader = p1Wins > p2Wins ? String(prediction?.player1Name ?? "Player 1") : String(prediction?.player2Name ?? "Player 2");
  const leaderWins = Math.max(p1Wins, p2Wins);
  const trailerWins = Math.min(p1Wins, p2Wins);
  return `${leader} leads ${leaderWins}–${trailerWins}`;
}

export function buildPredictionCopyText(prediction: any): string {
  const engine = prediction?.engine ?? {};
  const recommendation = getRecommendationLabel(prediction);
  const winProbability = getWinProbability(prediction);

  const lines: string[] = [];
  lines.push(`${String(prediction.predictedWinnerName ?? "Predicted Winner")}🥇`);
  lines.push("");

  if (typeof winProbability === "number") {
    lines.push(`${Math.round(winProbability)}% Win Probability`);
  }

  if (recommendation) {
    lines.push(`Recommendation: ${recommendation}`);
  }

  const upsetShort = UPSET_RISK_SHORT[prediction.upsetRisk as keyof typeof UPSET_RISK_SHORT] ?? String(prediction.upsetRisk ?? "");
  if (upsetShort) lines.push(`Upset Risk: ${upsetShort}`);

  if (typeof prediction.dataQuality === "number") {
    lines.push(`Data Quality: ${Math.round(Number(prediction.dataQuality))}%`);
  }

  if (prediction.predictedSetScore) lines.push(`Predicted Set Score: ${String(prediction.predictedSetScore)}`);

  if (engine.simulation && typeof engine.simulation.player1WinProbability === "number") {
    const { headlineWinProbability } = deriveMonteCarloHeadline({
      predictedWinnerId: String(prediction.predictedWinnerId),
      player1Id: String(prediction.player1Id),
      player1Name: String(prediction.player1Name),
      player2Name: String(prediction.player2Name),
      player1WinProbability: Number(engine.simulation.player1WinProbability),
      rangeLow: Number(engine.simulation.rangeLow ?? engine.simulation.player1WinProbability),
      rangeHigh: Number(engine.simulation.rangeHigh ?? engine.simulation.player1WinProbability),
    });
    lines.push(`Monte Carlo: ${Math.round(headlineWinProbability)}%`);
  }

  const headToHead = formatHeadToHead(prediction);
  if (headToHead) {
    lines.push(`Head-to-Head: ${headToHead}`);
  }

  lines.push("");
  lines.push("🤖Built with Tennis Matrix AI🤖 ");
  lines.push("TennisMatrixAI🎾Tennis Prediction App🔮");
  lines.push("Follow For launch Updates");
  lines.push("X: @TennisMatrixAI");
  lines.push("Instagram: @TennisMatrixAI");

  return lines.join("\n");
}
