import type { ModelVote } from "./ensemble";
import type { ModelAgreement } from "./disagreement";
import type { UpsetRisk } from "./upsetRisk";

const ELITE_DATA_QUALITY_THRESHOLD = 65; // matches the engine's own "Strong" data-quality label floor

export interface EliteTierInputs {
  dataQuality: number;
  /** Sign (favors player1 when true) of each of the three primary signals. */
  surfaceEloFavorsPlayer1: boolean;
  serveReturnFavorsPlayer1: boolean;
  recentFormFavorsPlayer1: boolean;
  /** True only when a segment specialist (real historical accuracy for this exact tour/surface) actually contributed. */
  specialistApplied: boolean;
  segmentLabel: string | null;
  /**
   * True only when the final calibrated pick agrees with the raw, reliability-weighted evidence
   * vote (see `modelConflict` in `index.ts`) -- i.e. calibration/specialist/simulator blending
   * didn't need to override the underlying signal. This is the "calibration passing" check: it's
   * computable identically whether the probability came from a live fitted calibration curve or
   * a walk-forward fold's own validation-fit mapping, unlike checking for a specific active
   * calibration row (which is a live-request-only concept and would make Elite tier impossible
   * to ever earn during backtesting).
   */
  modelConflict: boolean;
  /**
   * Elite-vs-risk consistency guardrail (2026-07-13 disagreement/upset-risk spec, Part 2E): a
   * prediction cannot be Elite while the governing disagreement reading is High Disagreement, or
   * while the recalibrated upset risk is High/Extreme -- "top-tier confidence" and "genuine
   * conflict/upset danger" are contradictory claims about the same prediction. The risk label
   * itself is never suppressed when this fires -- only the Elite badge is withheld, with a
   * visible reason (see the "not elite" branch below).
   */
  modelAgreement: ModelAgreement;
  upsetRisk: UpsetRisk;
}

export interface EliteTierResult {
  isEliteTier: boolean;
  reason: string;
}

/**
 * "Elite Prediction" tier (see the fix-the-engine spec, requirement 8): a strictly narrower, more
 * demanding bar than STRONG_RECOMMENDATION, gated on ALL of:
 *  - High data quality (>=65, the engine's own "Strong" floor).
 *  - The three primary signals (Surface Elo, Serve & Return, Recent Form) all agreeing on the
 *    same player -- not just a weighted average that happens to lean one way.
 *  - Real historical accuracy for this exact tour/surface segment supporting the confidence (a
 *    segment specialist that has actually cleared its data-sufficiency threshold and voted).
 *  - Calibration passing: the probability comes from the real fitted isotonic calibration (learned
 *    from actual graded outcomes), not the pre-fit heuristic fallback, and there's no model
 *    conflict between the raw evidence and the final pick.
 */
export function computeEliteTier(input: EliteTierInputs): EliteTierResult {
  const reasons: string[] = [];
  if (input.dataQuality < ELITE_DATA_QUALITY_THRESHOLD) reasons.push(`data quality ${input.dataQuality} is below the ${ELITE_DATA_QUALITY_THRESHOLD} floor`);

  const signals = [input.surfaceEloFavorsPlayer1, input.serveReturnFavorsPlayer1, input.recentFormFavorsPlayer1];
  const allAgree = signals.every((s) => s === signals[0]);
  if (!allAgree) reasons.push("Surface Elo, Serve & Return, and Recent Form don't all agree on the same player");

  if (!input.specialistApplied) reasons.push(`no validated segment specialist${input.segmentLabel ? ` for ${input.segmentLabel}` : ""} is backing this prediction with real historical accuracy`);

  if (input.modelConflict) reasons.push("calibration/specialist blending flipped the pick away from the raw evidence (model conflict) -- calibration did not pass");

  if (input.modelAgreement === "HighDisagreement") reasons.push("model agreement is High Disagreement -- the risk label is not suppressed, only the Elite badge is withheld");
  if (input.upsetRisk === "HIGH" || input.upsetRisk === "EXTREME") reasons.push(`upset risk is ${input.upsetRisk} -- the risk label is not suppressed, only the Elite badge is withheld`);

  if (reasons.length === 0) {
    return { isEliteTier: true, reason: "Elite: high data quality, Surface Elo/Serve & Return/Recent Form all agree, a validated segment specialist backs the call, and the calibrated pick agrees with the raw evidence (no model conflict)." };
  }
  return { isEliteTier: false, reason: `Not elite tier -- ${reasons.join("; ")}.` };
}

/** True when a ModelVote list's per-model votes for a given model name favor player1. */
export function voteFavorsPlayer1(models: ModelVote[], modelName: string): boolean {
  const vote = models.find((m) => m.modelName === modelName);
  return vote ? vote.player1Probability >= 50 : false;
}
