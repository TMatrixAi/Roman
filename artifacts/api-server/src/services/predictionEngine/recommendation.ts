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
  // Task #75: the dataQuality>=55 floor here was tuned before Task #68 excluded Head-to-Head from
  // the Data Quality blend, which pushed most real scores higher. A real walk-forward re-run
  // (docs/audit-task75-dq-threshold-revalidation.md) shows the 45-55 band is now the
  // best-calibrated slice of the whole distribution (log loss 0.662, only +2.6pt gap vs. observed
  // favorite win rate) -- better than 55-65 (log loss 0.693, -2.9pt gap), which the old >=55 floor
  // let through untouched while excluding the stronger 45-55 band. Lowered to 45 (the "Acceptable"
  // label floor) so STRONG_RECOMMENDATION reaches the segment the evidence actually supports.
  if (
    margin >= 22 &&
    dataQuality >= 45 &&
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
