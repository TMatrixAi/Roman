/**
 * The Monte Carlo simulator (backend) only ever stores player1-relative figures:
 * `player1WinProbability`, `rangeLow`, `rangeHigh`. The headline slot on the results page must
 * always show the PREDICTED WINNER's own number, regardless of whether that player happens to be
 * stored as player1 or player2 for this match -- mirror (100 - x) when the winner is player2.
 *
 * Regression guard: this used to be inlined directly in PredictionResult.tsx and always showed
 * player1's number verbatim, so whenever the predicted winner was player2, the simulation
 * headline silently displayed the LOSER's win probability. Extracted into its own pure function
 * so the binding logic itself is unit-testable without rendering the page.
 *
 * At an exact 50/50 toss-up, predictedWinnerId is deterministically player1's id (see
 * predictionEngine/index.ts: `favorsPlayer1 = calibratedProbability >= 50`), so `winnerIsPlayer1`
 * always resolves to a single, well-defined boolean -- no fallback/default is ever needed.
 */
export interface MonteCarloHeadlineInput {
  predictedWinnerId: string;
  player1Id: string;
  player1Name: string;
  player2Name: string;
  player1WinProbability: number;
  rangeLow: number;
  rangeHigh: number;
}

export interface MonteCarloHeadline {
  winnerIsPlayer1: boolean;
  headlineWinnerName: string;
  headlineWinProbability: number;
  headlineRangeLow: number;
  headlineRangeHigh: number;
}

export function deriveMonteCarloHeadline(input: MonteCarloHeadlineInput): MonteCarloHeadline {
  const winnerIsPlayer1 = input.predictedWinnerId === input.player1Id;
  return {
    winnerIsPlayer1,
    headlineWinnerName: winnerIsPlayer1 ? input.player1Name : input.player2Name,
    headlineWinProbability: winnerIsPlayer1 ? input.player1WinProbability : 100 - input.player1WinProbability,
    // Mirroring a [low, high] range flips which bound is which: the winner's low bound is
    // (100 - the stored high bound), and their high bound is (100 - the stored low bound).
    headlineRangeLow: winnerIsPlayer1 ? input.rangeLow : 100 - input.rangeHigh,
    headlineRangeHigh: winnerIsPlayer1 ? input.rangeHigh : 100 - input.rangeLow,
  };
}
