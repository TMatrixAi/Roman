import type { ModelAgreement } from "./ensemble";

export type UpsetRisk = "LOW" | "MODERATE" | "HIGH" | "EXTREME";

export function computeUpsetRisk(calibratedProbability: number, modelAgreement: ModelAgreement): UpsetRisk {
  const favoriteMargin = Math.abs(calibratedProbability - 50);

  if (favoriteMargin >= 30 && modelAgreement === "Strong") return "LOW";
  if (favoriteMargin >= 18 && (modelAgreement === "Strong" || modelAgreement === "Moderate")) return "MODERATE";
  if (favoriteMargin >= 8) return modelAgreement === "HighDisagreement" ? "EXTREME" : "HIGH";
  return "EXTREME";
}
