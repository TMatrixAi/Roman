export const RECOMMENDATION_LABELS: Record<string, string> = {
  STRONG_RECOMMENDATION: "Strong Recommendation",
  MODERATE_LEAN: "Moderate Lean",
  HIGH_RISK: "High Risk",
  NO_STRONG_SIGNAL: "No Strong Signal",
  DO_NOT_RECOMMEND: "Do Not Recommend",
}

export const RECOMMENDATION_SHORT_LABELS: Record<string, string> = {
  STRONG_RECOMMENDATION: "HIGH CONF",
  MODERATE_LEAN: "LEAN",
  HIGH_RISK: "RISK",
  NO_STRONG_SIGNAL: "COIN FLIP",
  DO_NOT_RECOMMEND: "NO REC",
}

export function getRecommendationLabel(recommendation: string): string {
  return RECOMMENDATION_LABELS[recommendation] ?? recommendation.replace(/_/g, " ")
}

export function getShortRecommendationLabel(recommendation: string): string {
  return RECOMMENDATION_SHORT_LABELS[recommendation] ?? recommendation.replace(/_/g, " ")
}