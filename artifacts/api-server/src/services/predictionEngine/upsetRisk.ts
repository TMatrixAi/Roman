import type { ModelAgreement } from "./ensemble";

export type UpsetRisk = "LOW" | "MODERATE" | "HIGH" | "EXTREME";

const TIERS: UpsetRisk[] = ["LOW", "MODERATE", "HIGH", "EXTREME"];

/**
 * Favorite-margin cutoffs below are derived from real walk-forward outcome data (4,080
 * out-of-sample test-segment predictions, regenerated 2026-07-12), not guessed:
 *
 *   cumulative real upset rate by favorite margin (calibratedProbability - 50):
 *     margin >= 0  : 43.5%      margin >= 18 : 31.2%
 *     margin >= 8  : 38.3%      margin >= 30 : 21.6%
 *
 *   non-cumulative bands (clearer picture of where the real risk actually breaks):
 *     0-8   : ~46-51% upset rate  (near coin-flip -- EXTREME)
 *     8-18  : ~38-46% upset rate  (still a live upset threat -- HIGH)
 *     18-30 : ~31-38% upset rate  (meaningfully safer than the above, but tennis stays
 *                                  high-variance even here -- MODERATE, not LOW)
 *     30+   : ~17-25% upset rate  (the only band where upsets become distinctly rare -- LOW)
 *
 * Note real upset rates never drop very low even at high margins (~17-25% at margin 30-50)
 * -- tennis is inherently high-variance, so LOW here means "meaningfully below baseline",
 * not "rare". These four bands are the most defensible split the real data supports; the
 * middle band (8-30) is a broad, somewhat noisy plateau rather than a sharp cliff, so the
 * 18 cutoff inside it is a reasonable midpoint rather than a hard discontinuity in the data.
 *
 * Model agreement could not be tuned the same way: walk-forward's historical scoring path
 * (scoreHistoricalMatch) is a reduced single-model reconstruction that never computes
 * modelAgreement, and the live paper-trading pipeline has not yet accumulated any graded
 * outcomes with a stored feature snapshot (checked live: 0 of 111 paper_trade rows have a
 * feature snapshot or a graded result). So there is no real outcome data to derive an
 * agreement-based cutoff from -- doing so would mean fabricating a threshold and presenting
 * it as data-driven. Real agreement-vs-outcome tuning is blocked on unifying backtests with
 * the full engine (a separate, pre-existing task) and/or paper trading running long enough
 * to accumulate graded, snapshotted results.
 *
 * Until that real data exists, HighDisagreement is treated as a real but modest and capped
 * modifier: it nudges the margin-derived tier one step worse, never more. Previously it (and
 * the Strong/Moderate gates on LOW/MODERATE) worked as hard requirements, which meant any
 * prediction that didn't land on "Strong" agreement collapsed straight to HIGH or EXTREME
 * regardless of how lopsided the real margin was -- collapsing the label distribution onto
 * HIGH/EXTREME instead of differentiating on the real, margin-driven signal above.
 */
export function computeUpsetRisk(calibratedProbability: number, modelAgreement: ModelAgreement): UpsetRisk {
  const favoriteMargin = Math.abs(calibratedProbability - 50);

  let tierIndex = favoriteMargin >= 30 ? 0 : favoriteMargin >= 18 ? 1 : favoriteMargin >= 8 ? 2 : 3;
  if (modelAgreement === "HighDisagreement") tierIndex = Math.min(tierIndex + 1, TIERS.length - 1);

  return TIERS[tierIndex];
}
