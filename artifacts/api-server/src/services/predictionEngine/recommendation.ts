import type { UpsetRisk } from "./upsetRisk";
import type { DataQualityLabel } from "./dataQuality";

export type Recommendation = "STRONG_RECOMMENDATION" | "MODERATE_LEAN" | "HIGH_RISK" | "DO_NOT_RECOMMEND";

export function computeRecommendation(
  calibratedProbability: number,
  dataQuality: number,
  dataQualityLabel: DataQualityLabel,
  upsetRisk: UpsetRisk,
): Recommendation {
  const margin = Math.abs(calibratedProbability - 50);

  if (dataQualityLabel === "Poor" || dataQuality < 25) return "DO_NOT_RECOMMEND";
  if (upsetRisk === "EXTREME") return "HIGH_RISK";
  if (margin >= 22 && dataQuality >= 55 && (upsetRisk === "LOW" || upsetRisk === "MODERATE")) return "STRONG_RECOMMENDATION";
  if (margin >= 10) return "MODERATE_LEAN";
  return "HIGH_RISK";
}
