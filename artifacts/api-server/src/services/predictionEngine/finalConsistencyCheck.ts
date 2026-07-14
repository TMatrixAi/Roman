import type { ModelAgreement } from "./disagreement";
import type { UpsetRisk } from "./upsetRisk";
import type { DataQualityLabel } from "./dataQuality";
import { computeRecommendation } from "./recommendation";

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
  /** "STRONG_RECOMMENDATION" | "MODERATE_LEAN" | "HIGH_RISK" | "NO_STRONG_SIGNAL" | "DO_NOT_RECOMMEND" from recommendation.ts. Typed loosely here to avoid a circular import; validated as a plain string. */
  recommendation: string;
  /** True when calibration/specialist/simulator blending flipped the pick away from the raw evidence vote (index.ts's `modelConflict`). */
  modelConflict: boolean;
  /** Non-null only when modelAgreement isn't "Strong" (disagreement.ts's `buildDisagreementNote` contract). */
  disagreementNote: string | null;
  /** Non-null only when `modelConflict` is true (index.ts's `modelConflictNote` construction). */
  modelConflictNote: string | null;
  /** The upset-risk breakdown's own auditable note (upsetRisk.ts's `buildUpsetRiskNote`). */
  upsetRiskNote: string;
  /** "W-L" set-count string for the predicted winner (e.g. "2-0"), as shown to users. */
  predictedSetScore: string;
  /** The same 0-100 Data Quality score `computeRecommendation` was actually given when `recommendation` was produced. */
  dataQuality: number;
  /** The same Data Quality label `computeRecommendation` was actually given when `recommendation` was produced. */
  dataQualityLabel: DataQualityLabel;
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

  // Rule 6: a Strong Recommendation is a confident directional claim -- it can never coexist with
  // High/Extreme upset risk (genuine upset danger) or Mixed/HighDisagreement model agreement (the
  // underlying models don't actually agree). `recommendation.ts` already gates STRONG_RECOMMENDATION
  // on these same conditions structurally; this is a defense-in-depth check against future drift,
  // mirroring how Rule 4 already guards the separate Elite tier claim.
  if (input.recommendation === "STRONG_RECOMMENDATION") {
    if (input.upsetRisk === "HIGH" || input.upsetRisk === "EXTREME") {
      violations.push(`Rule 6 (Strong Recommendation vs. upset risk): recommendation is STRONG_RECOMMENDATION while upsetRisk is ${input.upsetRisk}.`);
    }
    if (input.modelAgreement === "Mixed" || input.modelAgreement === "HighDisagreement") {
      violations.push(`Rule 6 (Strong Recommendation vs. model agreement): recommendation is STRONG_RECOMMENDATION while modelAgreement is ${input.modelAgreement}.`);
    }
  }

  // Rule 7: Elite tier is a strictly narrower, MORE demanding bar than a Strong Recommendation
  // (eliteTier.ts's doc comment) -- it can never be true at the same time as NO_STRONG_SIGNAL
  // ("the engine simply doesn't have a lean at all", recommendation.ts) or DO_NOT_RECOMMEND (data
  // quality too poor to trust). Those two recommendation tiers are the opposite claim from Elite.
  if (input.isEliteTier && (input.recommendation === "NO_STRONG_SIGNAL" || input.recommendation === "DO_NOT_RECOMMEND")) {
    violations.push(`Rule 7 (Elite vs. recommendation): isEliteTier is true while recommendation is ${input.recommendation} -- Elite requires a real, well-supported lean.`);
  }

  // Rule 8: the auditable explanation notes must never claim a disagreement/conflict exists when
  // the flag that gates them is false, or omit one that does exist -- e.g. the upsetRisk.ts bug
  // where a note said "the core models disagree on direction" while modelAgreement wasn't even
  // HighDisagreement (coreModelsConflict can only be true when modelAgreement is HighDisagreement,
  // see disagreement.ts's OR condition, so this check needs no extra flag beyond modelAgreement).
  if (input.modelAgreement === "Strong" && input.disagreementNote !== null) {
    violations.push(`Rule 8 (disagreement note vs. flag): disagreementNote is present while modelAgreement is Strong (buildDisagreementNote's contract says null exactly when Strong).`);
  }
  if (input.modelAgreement !== "Strong" && input.disagreementNote === null) {
    violations.push(`Rule 8 (disagreement note vs. flag): disagreementNote is null while modelAgreement is ${input.modelAgreement} -- a real disagreement must never go unexplained.`);
  }
  if (!input.modelConflict && input.modelConflictNote !== null) {
    violations.push(`Rule 8 (model-conflict note vs. flag): modelConflictNote is present while modelConflict is false.`);
  }
  if (input.modelConflict && input.modelConflictNote === null) {
    violations.push(`Rule 8 (model-conflict note vs. flag): modelConflictNote is null while modelConflict is true -- a real conflict must never go unexplained.`);
  }
  if (/core models disagree on direction/i.test(input.upsetRiskNote) && input.modelAgreement !== "HighDisagreement") {
    violations.push(
      `Rule 8 (upset-risk note vs. flag): upsetRiskNote claims "the core models disagree on direction" while modelAgreement is ${input.modelAgreement} -- that claim is only ever true when a genuine coreModelsConflict exists, which requires modelAgreement to be HighDisagreement.`,
    );
  }

  // Rule 9: the predicted winner's own projected set score must never imply they lose the match
  // (more sets for the opponent than for the winner). Parsed as plain "W-L" digits, winner first.
  const setScoreMatch = input.predictedSetScore.match(/^(\d+)-(\d+)$/);
  if (!setScoreMatch) {
    violations.push(`Rule 9 (set score format): predictedSetScore "${input.predictedSetScore}" is not a valid "W-L" set-count string.`);
  } else {
    const [, winnerSets, loserSets] = setScoreMatch.map(Number) as unknown as [number, number, number];
    if (winnerSets <= loserSets) {
      violations.push(`Rule 9 (set score vs. winner): predictedSetScore "${input.predictedSetScore}" does not show the predicted winner (listed first) taking more sets than the opponent.`);
    }
  }

  // Rule 10: the stored `recommendation` must always equal what `computeRecommendation` actually
  // produces for the same governing inputs (calibratedProbability, dataQuality/label, upsetRisk,
  // modelAgreement) -- there is exactly one recommendation-computing function, and this reading
  // must never be allowed to drift from it. This guards two different failure modes at once:
  //  - a bug in `recommendation.ts` itself (e.g. the margin 8-10 catch-all gap) shows up
  //    immediately on every NEW prediction, not just ones a human happens to eyeball;
  //  - a STALE recommendation -- a row whose `recommendation` was computed and stored under an
  //    older version of `computeRecommendation`'s logic and never recomputed -- is flagged the
  //    moment `checkFinalConsistency` is re-run against it (e.g. via the live-ledger batch scan),
  //    even though nothing about that specific bug's root cause needs to be known in advance.
  const expectedRecommendation = computeRecommendation(input.calibratedProbability, input.dataQuality, input.dataQualityLabel, input.upsetRisk, input.modelAgreement);
  if (input.recommendation !== expectedRecommendation) {
    violations.push(
      `Rule 10 (recommendation freshness): stored recommendation "${input.recommendation}" does not match what computeRecommendation currently produces ("${expectedRecommendation}") for calibratedProbability=${input.calibratedProbability}, dataQuality=${input.dataQuality}, dataQualityLabel=${input.dataQualityLabel}, upsetRisk=${input.upsetRisk}, modelAgreement=${input.modelAgreement} -- this recommendation is stale and was not recomputed under the current logic.`,
    );
  }

  return { violations };
}
