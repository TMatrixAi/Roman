import type { MatchRecord } from "../tennisData/types";
import type { OpponentEloLookup } from "./opponentStrength";

const BASELINE_ELO = 1500;

export interface MatchPerformance {
  match: MatchRecord;
  opponentElo: number | null;
  /** Elo-style expected score (0-1) against this specific opponent; null when opponent strength is unknown. */
  expectedScore: number | null;
  actualScore: 0 | 1;
  /** actualScore - expectedScore, null when opponentElo is unknown (no honest way to compute it). */
  performanceDelta: number | null;
}

/**
 * Converts each match into an opponent-adjusted performance point. When the opponent's real Elo
 * is known (from Phase 3's historical store), `performanceDelta` measures how much better/worse
 * the result was than expected against that specific opponent -- beating a strong opponent scores
 * far above a plain win, losing to a weak one scores far below a plain loss. When the opponent's
 * strength is unknown, `performanceDelta` is honestly left null rather than assumed "average".
 */
export function computeMatchPerformances(matches: MatchRecord[], opponentElo: OpponentEloLookup): MatchPerformance[] {
  return matches.map((match) => {
    const elo = opponentElo.get(match.id) ?? null;
    const actualScore: 0 | 1 = match.result === "W" ? 1 : 0;
    if (elo === null) {
      return { match, opponentElo: null, expectedScore: null, actualScore, performanceDelta: null };
    }
    const expectedScore = 1 / (1 + Math.pow(10, (elo - BASELINE_ELO) / 400));
    return { match, opponentElo: elo, expectedScore, actualScore, performanceDelta: actualScore - expectedScore };
  });
}

export function opponentAdjustedCoverage(performances: MatchPerformance[]): number {
  if (performances.length === 0) return 0;
  return performances.filter((p) => p.opponentElo !== null).length / performances.length;
}
