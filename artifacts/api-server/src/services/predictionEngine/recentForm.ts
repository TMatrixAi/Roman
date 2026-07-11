import type { MatchRecord } from "../tennisData/types";
import { computeMatchPerformances, opponentAdjustedCoverage } from "./matchPerformance";
import type { OpponentEloLookup } from "./opponentStrength";

export interface RecentFormResult {
  player1Form: number;
  player2Form: number;
  player1Trend: "improving" | "stable" | "declining";
  player2Trend: "improving" | "stable" | "declining";
  reliability: number;
  /** Share (0-100) of each player's recent matches for which a real opponent-strength estimate was available. */
  player1OpponentAdjustedCoverage: number;
  player2OpponentAdjustedCoverage: number;
  warnings: string[];
}

const WINDOW = 10;
const MIN_SAMPLE_FOR_NO_WARNING = 4;

function formScore(
  matches: MatchRecord[],
  opponentElo: OpponentEloLookup,
): { form: number; trend: "improving" | "stable" | "declining"; sample: number; coverage: number } {
  const recent = matches.slice(0, WINDOW); // matches are already sorted most-recent-first
  if (recent.length === 0) return { form: 50, trend: "stable", sample: 0, coverage: 0 };

  const performances = computeMatchPerformances(recent, opponentElo);
  const coverage = opponentAdjustedCoverage(performances);

  let weighted = 0;
  let weightTotal = 0;
  performances.forEach((p, i) => {
    const weight = Math.pow(0.85, i); // exponential recency decay
    // Opponent-adjusted: reward beating strong opponents, penalize losing to weak ones. When the
    // opponent's real strength isn't known, fall back to a plain win/loss contribution (0 or 1)
    // instead of guessing a strength -- honest degradation to the pre-Phase-5 behavior.
    const contribution = p.performanceDelta !== null ? 0.5 + p.performanceDelta / 2 : p.actualScore;
    weighted += weight * contribution;
    weightTotal += weight;
  });
  const form = Math.round((weighted / weightTotal) * 100);

  const half = Math.ceil(recent.length / 2);
  const newer = recent.slice(0, half);
  const older = recent.slice(half);
  const winRate = (arr: MatchRecord[]) => (arr.length ? arr.filter((m) => m.result === "W").length / arr.length : 0.5);
  const delta = winRate(newer) - winRate(older);

  const trend: "improving" | "stable" | "declining" = delta > 0.15 ? "improving" : delta < -0.15 ? "declining" : "stable";

  return { form, trend, sample: recent.length, coverage };
}

export function computeRecentFormModule(
  player1Matches: MatchRecord[],
  player2Matches: MatchRecord[],
  player1OpponentElo: OpponentEloLookup = new Map(),
  player2OpponentElo: OpponentEloLookup = new Map(),
): RecentFormResult {
  const p1 = formScore(player1Matches, player1OpponentElo);
  const p2 = formScore(player2Matches, player2OpponentElo);
  const minSample = Math.min(p1.sample, p2.sample);
  const reliability = Math.max(10, Math.min(100, minSample * 12));

  const warnings: string[] = [];
  if (minSample < MIN_SAMPLE_FOR_NO_WARNING) {
    warnings.push(`Recent-form sample is thin (as few as ${minSample} match(es) for one player) -- this signal is low-confidence.`);
  }
  if (p1.coverage < 0.5 || p2.coverage < 0.5) {
    warnings.push(
      "Opponent-strength data is only available for a minority of recent matches for one or both players -- form is partly opponent-adjusted and partly raw win/loss.",
    );
  }

  return {
    player1Form: p1.form,
    player2Form: p2.form,
    player1Trend: p1.trend,
    player2Trend: p2.trend,
    reliability: Math.round(reliability),
    player1OpponentAdjustedCoverage: Math.round(p1.coverage * 100),
    player2OpponentAdjustedCoverage: Math.round(p2.coverage * 100),
    warnings,
  };
}
