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

const PROXY_NOTE =
  "Provider does not expose point-level serve/return statistics for enough recent matches; ratings are derived from real set/game score margins across recent matches, weighted by real opponent strength where available, never fabricated.";

const REAL_STATS_NOTE =
  "Ratings are derived from the provider's real match-level point statistics (service/return points won), weighted by real opponent strength where available. Never fabricated or interpolated for matches without provider stats.";

const BASELINE_ELO = 1500;
const MIN_SAMPLE_FOR_NO_WARNING = 5;

// Rough tour-wide averages used only to center real service/return points-won percentages onto
// the same 0-100 "50 = average" rating scale the rest of the engine expects. These are stable,
// widely-cited approximations (not fetched from the provider), and only affect how a real,
// provider-reported percentage is displayed -- never used in place of missing provider data.
const TOUR_AVG_SERVICE_POINTS_WON_PCT = 62;
const TOUR_AVG_RETURN_POINTS_WON_PCT = 38;
const REAL_STATS_RATING_SCALE = 2.5;
const MIN_REAL_SAMPLE = 3;

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

/**
 * Real, provider-reported service/return points-won percentages for matches where the provider
 * included match-level statistics, weighted by real opponent strength where available (same
 * approach as the margin-based proxy). Returns null when fewer than MIN_REAL_SAMPLE matches have
 * real stats -- callers must fall back to the proxy rather than rate off a handful of matches.
 */
function realRatingsFromStats(
  matches: MatchRecord[],
  opponentElo: OpponentEloLookup,
): { serve: number; ret: number; sample: number; coverage: number } | null {
  const withStats = matches.filter((m) => m.stats?.servicePointsWonPct != null && m.stats?.returnPointsWon != null);
  if (withStats.length < MIN_REAL_SAMPLE) return null;

  let serveWeightedSum = 0;
  let retWeightedSum = 0;
  let weightTotal = 0;
  let coveredMatches = 0;
  for (const m of withStats) {
    const elo = opponentElo.get(m.id);
    const strengthFactor = elo !== undefined ? Math.max(0.6, Math.min(1.6, elo / BASELINE_ELO)) : 1;
    if (elo !== undefined) coveredMatches += 1;
    serveWeightedSum += m.stats!.servicePointsWonPct! * strengthFactor;
    retWeightedSum += m.stats!.returnPointsWon! * strengthFactor;
    weightTotal += strengthFactor;
  }
  const avgServicePct = serveWeightedSum / weightTotal;
  const avgReturnPct = retWeightedSum / weightTotal;
  const serve = Math.max(5, Math.min(95, 50 + (avgServicePct - TOUR_AVG_SERVICE_POINTS_WON_PCT) * REAL_STATS_RATING_SCALE));
  const ret = Math.max(5, Math.min(95, 50 + (avgReturnPct - TOUR_AVG_RETURN_POINTS_WON_PCT) * REAL_STATS_RATING_SCALE));
  return { serve, ret, sample: withStats.length, coverage: coveredMatches / withStats.length };
}

export function computeServeReturnModule(
  player1Matches: MatchRecord[],
  player2Matches: MatchRecord[],
  player1OpponentElo: OpponentEloLookup = new Map(),
  player2OpponentElo: OpponentEloLookup = new Map(),
): ServeReturnResult {
  // Prefer real, provider-reported point-level stats when both players have enough matches with
  // them -- a mix of real stats for one player and a proxy for the other isn't a fair comparison,
  // so the module falls back to the margin-based proxy for both players unless both clear the bar.
  const p1Real = realRatingsFromStats(player1Matches, player1OpponentElo);
  const p2Real = realRatingsFromStats(player2Matches, player2OpponentElo);

  if (p1Real && p2Real) {
    const minSample = Math.min(p1Real.sample, p2Real.sample);
    // Real data starts at a meaningfully higher floor than the proxy's 60 cap, and keeps climbing
    // with more matches -- unlike the proxy, this is never artificially capped at "not excellent".
    const reliability = Math.max(65, Math.min(95, 65 + (minSample - MIN_REAL_SAMPLE) * 5));

    const warnings: string[] = [];
    if (minSample < MIN_SAMPLE_FOR_NO_WARNING) {
      warnings.push(`Only ${minSample} match(es) with real point-level stats for one player -- confidence is limited despite using real data.`);
    }
    if (p1Real.coverage < 0.5 || p2Real.coverage < 0.5) {
      warnings.push("Opponent-strength weighting is only partially available -- some matches are weighted as opponent-neutral.");
    }

    return {
      player1ServeRating: Math.round(p1Real.serve),
      player2ServeRating: Math.round(p2Real.serve),
      player1ReturnRating: Math.round(p1Real.ret),
      player2ReturnRating: Math.round(p2Real.ret),
      reliability: Math.round(reliability),
      note: REAL_STATS_NOTE,
      warnings,
    };
  }

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
    note: PROXY_NOTE,
    warnings,
  };
}
