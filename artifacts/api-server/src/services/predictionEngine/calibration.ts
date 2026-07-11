/**
 * Shrinks a raw ensemble probability toward 50% as data quality drops, so a confident-looking
 * number is never shown when the underlying data is thin. This is a stand-in used ONLY before the
 * real, walk-forward-fitted isotonic calibration exists or is active (see
 * `evaluation/calibration.ts`, applied in `predictionEngine/index.ts`, and kept fresh by the
 * `job:calibration-refit` scheduled job) -- deferred to real statistical calibration whenever one
 * is available, never faked as a replacement for it.
 *
 * The curve below was re-derived from a real walk-forward evaluation over ~18.6k verified 2025
 * ATP/WTA/Challenger/ITF matches (ref: docs/audit-phase4-availability.md-adjacent investigation
 * for Task #21): pooled test-fold accuracy was 54.6-59% and log loss 0.667-0.713 (vs. a 0.693
 * coin-flip baseline) across all four folds -- i.e. a real, if modest, edge that held up even in
 * this corpus's mostly low-information ITF/Challenger matches. The fitted isotonic mapping itself
 * was close to the identity line for raw probabilities in the 40-60% band and only needed sharp
 * correction at the extremes (>85% or <15%) -- it did NOT show broad overconfidence in the
 * moderate range the way a `dataQuality/90` divisor implies.
 *
 * That old divisor also required near-perfect Data Quality (>=90) for full trust, which
 * structurally never happens for a typical prediction (Data Quality averages in module
 * reliabilities including Head-to-Head, which is near-zero for most matchups regardless of how
 * good the other signals are, since H2H is already down-weighted to near-zero influence on the
 * raw ensemble edge itself -- see `buildEnsemble`). That meant most real predictions sat at
 * Data Quality 48-63 ("Acceptable") and got compressed by a 0.53-0.70 factor for reasons the
 * outcome data doesn't support. The curve below reaches full trust at Data Quality 65 (the
 * existing "Strong" label threshold) instead of 90, and raises the floor for genuinely thin data
 * from 0.35 to 0.4 -- still real, deliberate shrinkage for "Limited"/"Poor" data, just not as
 * punishing for the common "Acceptable" case the evidence says already carries real signal.
 */
export function calibrateProbability(rawProbability: number, dataQuality: number): number {
  const confidenceFactor = Math.max(0.4, Math.min(1, (dataQuality - 20) / 45));
  const calibrated = 50 + (rawProbability - 50) * confidenceFactor;
  return Math.round(Math.max(5, Math.min(95, calibrated)) * 10) / 10;
}
