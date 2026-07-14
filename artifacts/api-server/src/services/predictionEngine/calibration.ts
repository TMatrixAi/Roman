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
 *
 * Task #151 re-validation: the flat 0.85 cap above was meant to stop granting MORE trust past
 * Data Quality 55, but a fresh full-corpus ablation report (2026-07-13,
 * `reports/model-ablation-analysis.json`, n=13,066) shows the underlying problem is worse than a
 * flat cap addresses -- real ACCURACY (not just stated confidence) is actively lower for
 * Data Quality >= 65 (56.0%, n=2,398) than below it (57.6%, n=10,668), and Task #75's own finer
 * bands already showed the overconfidence gap widening monotonically past 55 (55-65: 2.9pts;
 * 65-85: 4.6pts; 85-100: 10.7pts, log loss 0.719 -- worse than a 0.693 coin flip). A flat cap
 * treats all of 55-100 as equally (over-)trustworthy, when the evidence says trust should keep
 * DROPPING the further past 65 Data Quality climbs. The curve below keeps 0.85 only for the
 * genuinely-supported 55-65 band, then decays back down to the same 0.4 floor used for thin data
 * by Data Quality 100 -- past 85, the real accuracy/log-loss evidence shows this fallback has no
 * more business trusting the raw number than it does at the bottom of the scale.
 */
export function calibrateProbability(rawProbability: number, dataQuality: number): number {
  let confidenceFactor: number;
  if (dataQuality < 20) {
    confidenceFactor = 0.4;
  } else if (dataQuality < 55) {
    confidenceFactor = 0.4 + ((dataQuality - 20) / 35) * (0.85 - 0.4);
  } else if (dataQuality < 65) {
    confidenceFactor = 0.85;
  } else if (dataQuality < 85) {
    confidenceFactor = 0.85 - ((dataQuality - 65) / 20) * (0.85 - 0.55);
  } else {
    confidenceFactor = Math.max(0.4, 0.55 - ((dataQuality - 85) / 15) * (0.55 - 0.4));
  }
  const calibrated = 50 + (rawProbability - 50) * confidenceFactor;
  return Math.round(Math.max(5, Math.min(95, calibrated)) * 10) / 10;
}
