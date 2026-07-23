import { deriveMonteCarloHeadline } from "@/lib/monteCarloHeadline";
import { UPSET_RISK_SHORT } from "@/lib/upsetRiskColors";

const COPY_RECOMMENDATION_LABELS: Record<string, string> = {
  STRONG_RECOMMENDATION: "Strong Recommendation",
  MODERATE_LEAN: "Moderate Lean",
  HIGH_RISK: "High Risk",
  NO_STRONG_SIGNAL: "No Strong Signal",
  DO_NOT_RECOMMEND: "Do Not Recommend",
};

function toSocialReason(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const firstSentence = clean.split(/[.!?]\s/)[0]?.trim() ?? clean;
  const clipped = firstSentence.length > 88 ? `${firstSentence.slice(0, 85).trimEnd()}...` : firstSentence;
  return clipped;
}

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
    return "0–0 (Example)";
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

function getSocialReasons(prediction: any): string[] {
  const engine = prediction?.engine ?? {};
  const source = [
    ...(Array.isArray(engine.reasons) ? engine.reasons : []),
    ...(Array.isArray(engine.risks) ? engine.risks : []),
    ...(Array.isArray(engine.disclosures) ? engine.disclosures : []),
    ...(Array.isArray(engine.warnings) ? engine.warnings : []),
  ];

  const reasons: string[] = [];
  for (const item of source) {
    const reason = toSocialReason(String(item));
    if (reason && !reasons.includes(reason)) {
      reasons.push(reason);
    }
    if (reasons.length === 2) break;
  }

  return reasons;
}

export function buildPredictionCopyText(prediction: any): string {
  const engine = prediction?.engine ?? {};
  const recommendation = getRecommendationLabel(prediction);
  const winProbability = getWinProbability(prediction);
  const reasons = getSocialReasons(prediction);

  const lines: string[] = [];
  lines.push(String(prediction.predictedWinnerName ?? "Predicted Winner"));
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

  if (reasons.length > 0) {
    lines.push("");
    lines.push("Why:");
    lines.push(`- ${reasons[0]}`);
    if (reasons[1]) lines.push(`- ${reasons[1]}`);
  }

  lines.push("");
  lines.push("Built with Tennis Matrix AI");
  lines.push("AI Tennis Prediction App in development.");
  lines.push("Follow for launch updates.");

  if (lines.join("\n").length < 350) {
    lines.push("X: @TennisMatrixAI");
    lines.push("Instagram: @TennisMatrixAI");
  }

  let text = lines.join("\n");
  if (text.length < 350 && reasons.length > 2) {
    const extra = reasons.slice(2, 4).map((r) => `- ${r}`).join("\n");
    text = text.replace("\n\nBuilt with Tennis Matrix AI", `\n${extra}\n\nBuilt with Tennis Matrix AI`);
  }
  if (text.length > 600 && reasons.length > 1) {
    const trimmed = lines.filter((line) => line !== `- ${reasons[1]}`);
    text = trimmed.join("\n");
  }
  if (text.length > 600) {
    text = text.slice(0, 597).trimEnd() + "...";
  }
  return text;
}
