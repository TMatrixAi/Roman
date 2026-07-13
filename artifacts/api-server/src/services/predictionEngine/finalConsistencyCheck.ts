import type { ModelAgreement } from "./disagreement";
import type { UpsetRisk } from "./upsetRisk";

/**
 * Defense-in-depth guard applied as the LAST step inside `runPredictionEngine`, before
 * `EngineOutput` is returned (Task 56, Part C). Every rule below is already guaranteed
 * structurally by the code that builds each field -- `eliteTier.ts`'s 2026-07-13 Part 2E
 * guardrail already withholds Elite whenever modelAgreement is HighDisagreement or upsetRisk is
 * HIGH/EXTREME, and `predictedWinnerProbability` is already constructed by mirroring
 * `calibratedProbability` (see the field doc on `EngineOutput`). This module does not re-fix the
 * root cause (already fixed) -- it exists so a FUTURE change to any of those call sites can never
 * silently reintroduce the original bug report's exact failure mode (a prediction simultaneously
 * shown as Elite, High Disagreement, and "no model conflict") without at least a visible,
 * queryable violation being recorded.
 *
 * Never throws: a violation here means an upstream invariant broke, which is a signal to
 * withhold the confident claim (Elite tier) and surface the inconsistency, not to 500 a live
 * prediction request.
 */
export interface FinalConsistencyInput {
  player1Id: string;
  player2Id: string;
  /** Player-1-relative, pre-mirroring win probability (0-100). */
  calibratedProbability: number;
  predictedWinnerId: string;
  /** Must always be the predicted winner's own probability, mirrored from calibratedProbability. */
  predictedWinnerProbability: number;
  isEliteTier: boolean;
  eliteTierReason: string;
  /** The single governing disagreement reading used everywhere else in this same EngineOutput. */
  modelAgreement: ModelAgreement;
  /** The single governing upset-risk tier used everywhere else in this same EngineOutput. */
  upsetRisk: UpsetRisk;
  /** The upset-risk tier as recorded on the detailed breakdown object -- checked against `upsetRisk` above to catch the two ever silently diverging (rule 5, "single source of truth"). */
  upsetRiskBreakdownTier: UpsetRisk;
}

export interface FinalConsistencyResult {
  /** Empty in the overwhelming common case -- every rule already holds by construction. */
  violations: string[];
}

const PROBABILITY_EPSILON = 0.15;

/**
 * Checks the five consistency rules from the Task 56 spec:
 *  1. The predicted winner must be whichever player calibratedProbability actually favors.
 *  2. predictedWinnerProbability must be a valid, meaningful favorite probability (50-100).
 *  3. predictedWinnerProbability must be the exact mirrored complement of calibratedProbability
 *     -- never an independently-computed number that could drift from it.
 *  4. The Elite-tier reason string must never claim "no model conflict" while the governing
 *     disagreement/upset-risk reading says otherwise (the original bug report's exact shape).
 *  5. The plain upsetRisk tier and the detailed breakdown's own tier must be the same value --
 *     there is exactly one upset-risk reading per prediction, never two that could disagree.
 */
export function checkFinalConsistency(input: FinalConsistencyInput): FinalConsistencyResult {
  const violations: string[] = [];
  const favorsPlayer1 = input.calibratedProbability >= 50;
  const expectedWinnerId = favorsPlayer1 ? input.player1Id : input.player2Id;

  if (input.predictedWinnerId !== expectedWinnerId) {
    violations.push(
      `Rule 1 (winner/probability agreement): predictedWinnerId (${input.predictedWinnerId}) does not match the player calibratedProbability=${input.calibratedProbability} favors (${expectedWinnerId}).`,
    );
  }

  if (input.predictedWinnerProbability < 50 || input.predictedWinnerProbability > 100) {
    violations.push(`Rule 2 (probability bounds): predictedWinnerProbability ${input.predictedWinnerProbability} is outside the valid [50,100] range for a named favorite.`);
  }

  const expectedWinnerProbability = Math.round((favorsPlayer1 ? input.calibratedProbability : 100 - input.calibratedProbability) * 10) / 10;
  if (Math.abs(input.predictedWinnerProbability - expectedWinnerProbability) > PROBABILITY_EPSILON) {
    violations.push(
      `Rule 3 (complementary opponent probability): predictedWinnerProbability ${input.predictedWinnerProbability} is not the mirrored complement of calibratedProbability ${input.calibratedProbability} (expected ${expectedWinnerProbability}).`,
    );
  }

  const structurallyConflicted = input.modelAgreement === "HighDisagreement" || input.upsetRisk === "HIGH" || input.upsetRisk === "EXTREME";
  const claimsNoConflict = /no model conflict/i.test(input.eliteTierReason);
  if (claimsNoConflict && structurallyConflicted) {
    violations.push(
      `Rule 4 (Elite wording vs. risk): eliteTierReason claims "no model conflict" while modelAgreement=${input.modelAgreement} and upsetRisk=${input.upsetRisk}.`,
    );
  }
  if (input.isEliteTier && structurallyConflicted) {
    violations.push(
      `Rule 4 (Elite gate vs. risk): isEliteTier is true while modelAgreement=${input.modelAgreement} and upsetRisk=${input.upsetRisk} -- Elite and High Disagreement/High-or-Extreme upset risk can never both be true for the same prediction.`,
    );
  }

  if (input.upsetRisk !== input.upsetRiskBreakdownTier) {
    violations.push(
      `Rule 5 (single source of truth): top-level upsetRisk (${input.upsetRisk}) disagrees with the detailed breakdown's own tier (${input.upsetRiskBreakdownTier}).`,
    );
  }

  return { violations };
}
