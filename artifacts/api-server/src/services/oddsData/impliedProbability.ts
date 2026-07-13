/**
 * Removes the bookmaker's margin ("vig") from a pair of decimal head-to-head odds to get a real
 * implied win probability for player1. Raw 1/odds probabilities always sum to slightly more than
 * 1 (that excess IS the vig); dividing each side by the sum removes it proportionally, which is
 * the standard, provider-agnostic de-vigging method (no market-specific data needed beyond the
 * two prices themselves).
 *
 * Returns null (never a guessed number) when either price isn't a real, usable decimal price --
 * decimal odds must be > 1 (anything <= 1 isn't a valid decimal price for a two-outcome market).
 */
export function computeVigAdjustedImpliedProbability(player1DecimalOdds: number, player2DecimalOdds: number): number | null {
  if (!Number.isFinite(player1DecimalOdds) || !Number.isFinite(player2DecimalOdds)) return null;
  if (player1DecimalOdds <= 1 || player2DecimalOdds <= 1) return null;

  const raw1 = 1 / player1DecimalOdds;
  const raw2 = 1 / player2DecimalOdds;
  const overround = raw1 + raw2;
  if (!(overround > 0)) return null;

  // 0-100 scale, player1-relative, matching the rest of the codebase's probability convention
  // (rawProbability/calibratedProbability).
  return (raw1 / overround) * 100;
}
