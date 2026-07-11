export type DataQualityLabel = "Excellent" | "Strong" | "Acceptable" | "Limited" | "Poor";

export function computeDataQuality(reliabilities: number[]): { score: number; label: DataQualityLabel } {
  const score = Math.round(reliabilities.reduce((sum, r) => sum + r, 0) / reliabilities.length);
  const label: DataQualityLabel = score >= 85 ? "Excellent" : score >= 65 ? "Strong" : score >= 45 ? "Acceptable" : score >= 25 ? "Limited" : "Poor";
  return { score, label };
}
