import type { UpsetRisk } from "./upsetRisk";
import type { DataQualityLabel } from "./dataQuality";
import type { ModelAgreement } from "./ensemble";

export type Recommendation = "STRONG_RECOMMENDATION" | "MODERATE_LEAN" | "HIGH_RISK" | "NO_STRONG_SIGNAL" | "DO_NOT_RECOMMEND";

/**
 * NO_STRONG_SIGNAL is distinct from HIGH_RISK: HIGH_RISK means the engine has a real lean but the
 * matchup carries genuine upset danger (e.g. a big favorite who could plausibly lose).
 * NO_STRONG_SIGNAL means the engine simply doesn't have a lean at all -- the probability is close
 * to a coin flip AND the underlying models don't agree -- so there's nothing meaningful to
 * recommend either way, as opposed to a real signal that's merely risky.
 */
export function computeRecommendation(
  calibratedProbability: number,
  dataQuality: number,
  dataQualityLabel: DataQualityLabel,
  upsetRisk: UpsetRisk,
  modelAgreement: ModelAgreement,
): Recommendation {
  const margin = Math.abs(calibratedProbability - 50);

  if (dataQualityLabel === "Poor" || dataQuality < 25) return "DO_NOT_RECOMMEND";
  if (margin < 8 && (modelAgreement === "Mixed" || modelAgreement === "HighDisagreement")) return "NO_STRONG_SIGNAL";
  if (upsetRisk === "EXTREME") return "HIGH_RISK";
  if (
    margin >= 22 &&
    dataQuality >= 55 &&
    (upsetRisk === "LOW" || upsetRisk === "MODERATE") &&
    modelAgreement !== "Mixed" &&
    modelAgreement !== "HighDisagreement"
  )
    return "STRONG_RECOMMENDATION";
  if (margin >= 10) return "MODERATE_LEAN";
  // Margin 8-10 (exclusive of the >=10 branch above, so effectively [8, 10)) with a genuinely
  // low/moderate upset risk and non-Mixed/HighDisagreement agreement is a real, if modest, lean --
  // not a case of "genuine upset danger" (HIGH_RISK's documented meaning above). Falling through
  // to HIGH_RISK for these rows mislabeled otherwise-unremarkable matches as risky.
  if (
    margin >= 8 &&
    (upsetRisk === "LOW" || upsetRisk === "MODERATE") &&
    modelAgreement !== "Mixed" &&
    modelAgreement !== "HighDisagreement"
  )
    return "MODERATE_LEAN";
  return "HIGH_RISK";
}
