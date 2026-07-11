/**
 * Shrinks a raw ensemble probability toward 50% as data quality drops, so a confident-looking
 * number is never shown when the underlying data is thin. This is a simplified stand-in for full
 * statistical calibration (Brier score / isotonic regression), which needs a historical
 * backtesting corpus we don't have yet -- deferred, not faked.
 */
export function calibrateProbability(rawProbability: number, dataQuality: number): number {
  const confidenceFactor = Math.max(0.35, Math.min(1, dataQuality / 90));
  const calibrated = 50 + (rawProbability - 50) * confidenceFactor;
  return Math.round(Math.max(5, Math.min(95, calibrated)) * 10) / 10;
}
