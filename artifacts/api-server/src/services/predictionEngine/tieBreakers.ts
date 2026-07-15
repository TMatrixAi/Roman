import type { computeSurfaceEloModule } from "./surfaceElo";
import type { computeServeReturnModule } from "./serveReturn";
import type { computeRecentFormModule } from "./recentForm";
import type { computeFatigueModule } from "./fatigue";
import type { computeHeadToHeadModule } from "./headToHead";
import type { MatchRecord, PlayerProfile, Surface } from "../tennisData/types";

/** How close the raw ensemble probability has to sit to 50 before the close-match disclosure fires. */
export const TIE_BAND = 3;

export interface TieBreakerInputs {
  surfaceElo: ReturnType<typeof computeSurfaceEloModule>;
  serveReturn: ReturnType<typeof computeServeReturnModule>;
  recentForm: ReturnType<typeof computeRecentFormModule>;
  fatigue: ReturnType<typeof computeFatigueModule>;
  headToHead: ReturnType<typeof computeHeadToHeadModule>;
  player1: PlayerProfile;
  player2: PlayerProfile;
  player1Matches: MatchRecord[];
  player2Matches: MatchRecord[];
  surface: Surface;
}

export interface TieBreakerResult {
  applied: boolean;
  direction: 1 | -1 | 0;
  adjustedProbability: number;
  note: string | null;
  decidingStep: string | null;
}

/**
 * Identifies genuinely close matchups (raw ensemble within `TIE_BAND` of 50) and surfaces an
 * honest disclosure. No directional nudge is applied.
 *
 * HISTORY — why the old cascade was removed (Task #5, 2026-07-15):
 * The previous implementation ran a 7-step priority cascade (Serve & Return → Surface Elo →
 * Recent Form → surface win-rate history → ranking → Fatigue → Head-to-Head) and nudged the
 * probability by ±2.5 points whenever a step had a non-trivial signal. A graded-outcome audit
 * against 1,509 validation rows where the cascade actually fired found every step with usable
 * sample size performed at or below a coin flip in the tight-signal regime:
 *
 *   - Serve & Return (n=1,374, decides 91% of cases): 53.7% accuracy
 *   - Surface Elo (n=120): 46.7% accuracy (worse than random)
 *   - Non-applied baseline: 66.7% accuracy
 *
 * Every applied step was 13–20 points below the non-applied baseline. Nudging the probability
 * in a direction validated to be wrong is actively worse than passing the raw ensemble number
 * through unchanged. It was also dishonest: the cascade displayed a named justification ("Serve &
 * Return gives a modest lean") that reads as trustworthy while performing worse than an explicit
 * 50/50 would.
 *
 * The fix: when within TIE_BAND, the raw ensemble probability passes through unchanged with an
 * honest "genuinely close matchup" note. `applied: true` is still set so the UI can surface the
 * disclosure without implying any directional lean was taken. `decidingStep` is always null.
 *
 * The `_inputs` parameter is retained for call-site compatibility but is intentionally unused —
 * the cascade that read from it was the thing being removed.
 */
export function applyTieBreaker(rawEnsembleProbability: number, _inputs: TieBreakerInputs): TieBreakerResult {
  if (Math.abs(rawEnsembleProbability - 50) >= TIE_BAND) {
    return { applied: false, direction: 0, adjustedProbability: rawEnsembleProbability, note: null, decidingStep: null };
  }

  return {
    applied: true,
    direction: 0,
    adjustedProbability: rawEnsembleProbability,
    decidingStep: null,
    note: `Core signals are within ${TIE_BAND} points of a coin flip (raw ${rawEnsembleProbability.toFixed(1)}%) — this is a genuinely close matchup where no validated tie-break signal provides a reliable directional edge in the tight-signal regime. The ensemble's natural probability is used as-is; no directional nudge is applied.`,
  };
}
