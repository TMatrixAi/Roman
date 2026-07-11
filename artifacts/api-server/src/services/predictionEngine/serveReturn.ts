import type { MatchRecord } from "../tennisData/types";
import type { OpponentEloLookup } from "./opponentStrength";

export interface ServeReturnResult {
  player1ServeRating: number;
  player2ServeRating: number;
  player1ReturnRating: number;
  player2ReturnRating: number;
  reliability: number;
  note: string | null;
  warnings: string[];
}

const NOTE =
  "Provider does not expose point-level serve/return statistics; ratings are derived from real set/game score margins across recent matches, weighted by real opponent strength where available, never fabricated.";

const BASELINE_ELO = 1500;
const MIN_SAMPLE_FOR_NO_WARNING = 5;

/**
 * Average games-per-set differential in matches won vs lost, as a serve/return dominance proxy,
 * weighted by the real strength of the opponent when it's known (a set margin against a strong
 * opponent counts for more than the same margin against a weak one) instead of treating every
 * match equally.
 */
function ratingsFromMargins(
  matches: MatchRecord[],
  opponentElo: OpponentEloLookup,
): { serve: number; ret: number; sample: number; coverage: number } {
  const withMargins = matches.filter((m) => m.setGameMargins.length > 0);
  if (withMargins.length === 0) return { serve: 50, ret: 50, sample: 0, coverage: 0 };

  let weightedMarginSum = 0;
  let weightTotal = 0;
  let coveredMatches = 0;
  for (const m of withMargins) {
    const elo = opponentElo.get(m.id);
    const strengthFactor = elo !== undefined ? Math.max(0.6, Math.min(1.6, elo / BASELINE_ELO)) : 1;
    if (elo !== undefined) coveredMatches += 1;
    for (const set of m.setGameMargins) {
      weightedMarginSum += (set.playerGames - set.opponentGames) * strengthFactor;
      weightTotal += strengthFactor;
    }
  }
  const avgMargin = weightTotal > 0 ? weightedMarginSum / weightTotal : 0;
  // Map an average game-margin per set (roughly -6..6) onto a 0-100 rating centered at 50.
  const rating = Math.max(5, Math.min(95, 50 + avgMargin * 6));
  return { serve: rating, ret: rating, sample: withMargins.length, coverage: coveredMatches / withMargins.length };
}

export function computeServeReturnModule(
  player1Matches: MatchRecord[],
  player2Matches: MatchRecord[],
  player1OpponentElo: OpponentEloLookup = new Map(),
  player2OpponentElo: OpponentEloLookup = new Map(),
): ServeReturnResult {
  const p1 = ratingsFromMargins(player1Matches, player1OpponentElo);
  const p2 = ratingsFromMargins(player2Matches, player2OpponentElo);

  const minSample = Math.min(p1.sample, p2.sample);
  const reliability = Math.max(5, Math.min(60, minSample * 6)); // capped -- this is a proxy, never "excellent"

  const warnings: string[] = [];
  if (minSample < MIN_SAMPLE_FOR_NO_WARNING) {
    warnings.push(`Only ${minSample} match(es) with recorded set scores for one player -- serve/return proxy is low-confidence.`);
  }
  if (p1.coverage < 0.5 || p2.coverage < 0.5) {
    warnings.push("Opponent-strength weighting is only partially available -- some matches are weighted as opponent-neutral.");
  }

  return {
    player1ServeRating: Math.round(p1.serve),
    player2ServeRating: Math.round(p2.serve),
    player1ReturnRating: Math.round(p1.ret),
    player2ReturnRating: Math.round(p2.ret),
    reliability: Math.round(reliability),
    note: NOTE,
    warnings,
  };
}
