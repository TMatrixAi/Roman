/**
 * Shrinks a raw ensemble probability toward 50% as data quality drops, so a confident-looking
 * number is never shown when the underlying data is thin. This is a stand-in used ONLY before the
 * real, walk-forward-fitted isotonic calibration exists or is active (see
 * `evaluation/calibration.ts`, applied in `predictionEngine/index.ts`, and kept fresh by the
 * `job:calibration-refit` scheduled job) -- deferred to real statistical calibration whenever one
 * is available, never faked as a replacement for it.
 *
 * Re-validated for Task #75 after Task #68 excluded Head-to-Head from the Data Quality blend
 * (which pushed most real scores meaningfully higher). A fresh walk-forward re-run plus the live
 * paper-trade/live ledger (n=4,111 graded, accuracy-eligible rows, `docs/audit-task75-dq-threshold-revalidation.md`)
 * shows the DQ-to-accuracy relationship the old 20-65 anchors assumed no longer holds: calibration
 * is good (gap within ~3pts of the observed favorite win rate, log loss 0.662-0.677) for Data
 * Quality up to ~55, then gets WORSE the higher Data Quality climbs -- 55-65 is already
 * overconfident by 2.9pts, 65-85 by 4.6pts, and 85-100 by fully 10.7pts (n=422), with log loss
 * rising to 0.719 (worse than a 0.693 coin flip). The old anchors (full trust at 65, i.e. the
 * "Strong" label floor) reward exactly the regime that is now least trustworthy. The curve below
 * moves the "as much trust as this fallback ever grants" point down to Data Quality 55 (where the
 * real data stops supporting further trust) and caps the factor at 0.85 instead of 1.0 -- even the
 * best-calibrated band (45-55) wasn't perfectly calibrated, so this stand-in should never claim
 * full, unshrunk trust in the raw ensemble number. The floor (0.4) is unchanged: Data Quality below
 * 20 showed no evidence either way in this data, and it remains genuine, deliberate shrinkage for
 * thin data as a safety margin, not something to relax.
 */
export function calibrateProbability(rawProbability: number, dataQuality: number): number {
  const confidenceFactor = Math.max(0.4, Math.min(0.85, (dataQuality - 20) / 35));
  const calibrated = 50 + (rawProbability - 50) * confidenceFactor;
  return Math.round(Math.max(5, Math.min(95, calibrated)) * 10) / 10;
}
