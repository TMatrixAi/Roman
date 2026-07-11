import type { MatchRecord } from "../tennisData/types";

export interface ServeReturnResult {
  player1ServeRating: number;
  player2ServeRating: number;
  player1ReturnRating: number;
  player2ReturnRating: number;
  reliability: number;
  note: string | null;
}

const NOTE =
  "Provider does not expose point-level serve/return statistics; ratings are derived from real set/game score margins across recent matches, not fabricated.";

/** Average games-per-set differential in matches won vs lost, as a serve/return dominance proxy. */
function ratingsFromMargins(matches: MatchRecord[]): { serve: number; ret: number; sample: number } {
  const withMargins = matches.filter((m) => m.setGameMargins.length > 0);
  if (withMargins.length === 0) return { serve: 50, ret: 50, sample: 0 };

  let marginSum = 0;
  let sets = 0;
  for (const m of withMargins) {
    for (const set of m.setGameMargins) {
      marginSum += set.playerGames - set.opponentGames;
      sets += 1;
    }
  }
  const avgMargin = sets > 0 ? marginSum / sets : 0;
  // Map an average game-margin per set (roughly -6..6) onto a 0-100 rating centered at 50.
  const rating = Math.max(5, Math.min(95, 50 + avgMargin * 6));
  return { serve: rating, ret: rating, sample: withMargins.length };
}

export function computeServeReturnModule(player1Matches: MatchRecord[], player2Matches: MatchRecord[]): ServeReturnResult {
  const p1 = ratingsFromMargins(player1Matches);
  const p2 = ratingsFromMargins(player2Matches);

  const minSample = Math.min(p1.sample, p2.sample);
  const reliability = Math.max(5, Math.min(60, minSample * 6)); // capped -- this is a proxy, never "excellent"

  return {
    player1ServeRating: Math.round(p1.serve),
    player2ServeRating: Math.round(p2.serve),
    player1ReturnRating: Math.round(p1.ret),
    player2ReturnRating: Math.round(p2.ret),
    reliability: Math.round(reliability),
    note: NOTE,
  };
}
