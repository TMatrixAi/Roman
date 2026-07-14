// One-off, expensive batch analysis (per `follow-up-tasks`/spec conventions this is NOT re-run
// casually). Reads every finished historical match in chronological order, and for each player's
// appearance in a match with enough real history on both sides (a prior window to label a trend,
// a future window to check what actually happened next), computes a candidate trend label under
// several threshold/min-sample configurations and compares it against that player's REAL
// subsequent win rate. This is the calibration basis for the improving/stable/declining
// thresholds hardcoded in `recentForm.ts` -- run once, results transcribed into code with this
// script's output as the citation (2026-07-13 Recent Form recalibration).
//
// Three delta signals are compared:
//   1. Plain win-rate delta (the pre-existing recentForm.ts logic) -- newer-half win rate minus
//      older-half win rate, no opponent adjustment.
//   2. Opponent-adjusted performance delta -- same newer/older split, but each match contributes
//      (actualScore - expectedScoreVsOpponent) using the same real eloOverall history the live
//      engine's opponent-adjustment already relies on (see `opponentStrength.ts`), falling back
//      to plain win/loss when an opponent's Elo was never resolved. This is expected to separate
//      genuine form swings from streaks that are really just "faced weaker/stronger opponents".
//   3. Opponent-AND-serve/return-adjusted delta -- Task #71 re-check, on top of signal 2: each
//      match's contribution is further blended with a real, provider-reported serve/return
//      quality rating (`SERVE_RETURN_BLEND_WEIGHT`), using the exact same tour-average constants,
//      rating scale, and blend weight `recentForm.ts`'s live `formScore` uses for its own trend
//      calculation -- NOT a re-derivation, so this signal is a faithful backtest of what the live
//      module actually computes today (unlike signal 2, which only reflects the module's PRE-
//      serve/return-blend behavior). Stats come from the same frozen `rawSource` payload the live
//      engine's `matchRecordReconstruction.ts` already reads (via `mapStatistics`), so this needs
//      no new data collection or waiting period -- the corpus already carries real stats wherever
//      the provider reported them. Signals 2 and 3 both also replicate `formScore`'s FULL
//      per-match weight (recency decay, tournament-level weight, surface-mismatch deweight,
//      retired/walkover deweight -- see `fullWeightsFor` below), not just recency decay alone,
//      since those weights materially change which matches dominate each half-window's average
//      and a backtest missing them isn't a faithful proxy for the live trend calculation.
//
// Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/analyzeRecentFormTrendValidity.ts
import { db, historicalMatchesTable, matchFeatureSnapshotsTable, pool } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { mapStatistics, type RawMatch } from "../services/tennisData/apiTennisProvider";

// Mirrors recentForm.ts's own constants exactly -- kept as a separate local copy for the same
// reason recentForm.ts keeps its own copies of surfaceElo.ts's tables (see that file's comments):
// this script is a one-off, run-once backtest, not a shared runtime module, so importing the live
// constants would couple a throwaway script to internal module structure for no real benefit.
const TOUR_AVG_SERVICE_POINTS_WON_PCT = 62;
const TOUR_AVG_RETURN_POINTS_WON_PCT = 38;
const REAL_STATS_RATING_SCALE = 2.5;
const SERVE_RETURN_BLEND_WEIGHT = 0.25;

// Exact copy of recentForm.ts's per-match weight stack (recency decay handled separately below,
// this is the rest of it: level weight, surface-mismatch deweight, retired/walkover deweight).
// The 2026-07-14 re-check (task #71) initially omitted this whole stack and only replicated the
// recency-decay term -- rejected in code review because those weights materially change which
// matches dominate each half-window's average, so a backtest without them isn't a faithful proxy
// for the live trend calculation, even though it uses the real serve/return blend.
const LEVEL_WEIGHT: Partial<Record<string, number>> = {
  GrandSlam: 1.3,
  Masters1000: 1.25,
  WTA1000: 1.25,
  ATP500: 1.1,
  WTA500: 1.1,
  ATP250: 1.0,
  WTA250: 1.0,
  Challenger: 0.75,
  ITF: 0.6,
  Other: 0.85,
};
const DEFAULT_LEVEL_WEIGHT = 0.85;
const SURFACE_MISMATCH_WEIGHT = 0.7;
const RETIRED_OR_WALKOVER_WEIGHT = 0.35;

function levelWeight(level: string | null): number {
  if (!level) return DEFAULT_LEVEL_WEIGHT;
  return LEVEL_WEIGHT[level] ?? DEFAULT_LEVEL_WEIGHT;
}

const PAST_WINDOW = 10;
const FUTURE_WINDOW = 5;
const MIN_FUTURE_SAMPLE = 3; // allow a slightly short future window near the end of a player's record rather than discarding all of it
const BASELINE_ELO = 1500;

interface Candidate {
  label: string;
  deltaThreshold: number;
  minSample: number;
}

const CANDIDATES: Candidate[] = [
  { label: "0.15 delta, no sample floor", deltaThreshold: 0.15, minSample: 0 },
  { label: "0.15 delta, min 6 sample", deltaThreshold: 0.15, minSample: 6 },
  { label: "0.20 delta, min 6 sample", deltaThreshold: 0.2, minSample: 6 },
  { label: "0.25 delta, min 6 sample", deltaThreshold: 0.25, minSample: 6 },
  { label: "0.25 delta, min 8 sample", deltaThreshold: 0.25, minSample: 8 },
  { label: "0.30 delta, min 8 sample", deltaThreshold: 0.3, minSample: 8 },
];

type PlayerAppearance = {
  won: boolean;
  opponentId: string;
  date: number;
  srRating: number | null;
  tournamentLevel: string | null;
  surface: string | null;
  retired: boolean;
  walkover: boolean;
};

function expectedScoreVs(opponentId: string, matchTime: number, eloHistory: Map<string, Array<{ t: number; elo: number }>>): number | null {
  const history = eloHistory.get(opponentId);
  if (!history || history.length === 0) return null;
  let best: number | null = null;
  for (const point of history) {
    if (point.t < matchTime) best = point.elo;
    else break;
  }
  if (best === null) return null;
  return 1 / (1 + Math.pow(10, (best - BASELINE_ELO) / 400));
}

/** Exact copy of recentForm.ts's `serveReturnQualityRating`, applied to a real `MatchStatLine`. */
function serveReturnQualityRating(servicePct: number | null, returnPct: number | null): number | null {
  if (servicePct === null && returnPct === null) return null;
  const parts: number[] = [];
  if (servicePct !== null) parts.push(50 + (servicePct - TOUR_AVG_SERVICE_POINTS_WON_PCT) * REAL_STATS_RATING_SCALE);
  if (returnPct !== null) parts.push(50 + (returnPct - TOUR_AVG_RETURN_POINTS_WON_PCT) * REAL_STATS_RATING_SCALE);
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.max(5, Math.min(95, avg));
}

async function main(): Promise<void> {
  const rows = await db.select().from(historicalMatchesTable).orderBy(asc(historicalMatchesTable.scheduledStartAt), asc(historicalMatchesTable.id));
  console.log(`Loaded ${rows.length} historical matches`);

  const eloRows = await db
    .select({ playerId: matchFeatureSnapshotsTable.playerId, featureValue: matchFeatureSnapshotsTable.featureValue, sourceTimestamp: matchFeatureSnapshotsTable.sourceTimestamp })
    .from(matchFeatureSnapshotsTable)
    .where(eq(matchFeatureSnapshotsTable.featureName, "eloOverall"));
  const eloHistory = new Map<string, Array<{ t: number; elo: number }>>();
  for (const r of eloRows) {
    const list = eloHistory.get(r.playerId) ?? [];
    list.push({ t: r.sourceTimestamp.getTime(), elo: r.featureValue });
    eloHistory.set(r.playerId, list);
  }
  for (const list of eloHistory.values()) list.sort((a, b) => a.t - b.t);
  console.log(`Loaded eloOverall history for ${eloHistory.size} players`);

  let statsResolvedCount = 0;
  const byPlayer = new Map<string, PlayerAppearance[]>();
  for (const m of rows) {
    if (m.cancelled) continue;
    const p1Won = m.winnerId === m.player1Id;
    const t = m.scheduledStartAt.getTime();
    // Same provider gate matchRecordReconstruction.ts's `statsFor` uses -- mapStatistics is tied
    // to API-Tennis's specific payload shape, so any other provider honestly yields no stats.
    const raw = m.provider === "API-Tennis" ? (m.rawSource as RawMatch) : null;
    const push = (playerId: string, opponentId: string, won: boolean) => {
      const stat = raw ? mapStatistics(raw, playerId) : null;
      const srRating = stat ? serveReturnQualityRating(stat.servicePointsWonPct, stat.returnPointsWon) : null;
      if (srRating !== null) statsResolvedCount += 1;
      const list = byPlayer.get(playerId) ?? [];
      list.push({ won, opponentId, date: t, srRating, tournamentLevel: m.tournamentLevel, surface: m.surface, retired: m.retired, walkover: m.walkover });
      byPlayer.set(playerId, list);
    };
    push(m.player1Id, m.player2Id, p1Won);
    push(m.player2Id, m.player1Id, !p1Won);
  }
  for (const list of byPlayer.values()) list.reverse(); // most-recent-first, matching the live module's convention
  console.log(`Tracked ${byPlayer.size} distinct players`);
  const totalAppearances = Array.from(byPlayer.values()).reduce((sum, l) => sum + l.length, 0);
  console.log(`Real serve/return stats resolved for ${statsResolvedCount}/${totalAppearances} appearances (${((statsResolvedCount / totalAppearances) * 100).toFixed(1)}%)`);

  const winRate = (arr: PlayerAppearance[]) => (arr.length ? arr.filter((m) => m.won).length / arr.length : 0.5);

  function contributionsFor(past: PlayerAppearance[], blendServeReturn: boolean): number[] {
    return past.map((m) => {
      const expected = expectedScoreVs(m.opponentId, m.date, eloHistory);
      const actual = m.won ? 1 : 0;
      const outcomeContribution = expected !== null ? 0.5 + (actual - expected) / 2 : actual;
      if (!blendServeReturn || m.srRating === null) return outcomeContribution;
      // Exact same blend formula as recentForm.ts's live `formScore` uses today.
      return outcomeContribution * (1 - SERVE_RETURN_BLEND_WEIGHT) + (m.srRating / 100) * SERVE_RETURN_BLEND_WEIGHT;
    });
  }

  /**
   * Exact copy of `formScore`'s per-match weight (recency decay * level weight * surface-
   * mismatch deweight * retired/walkover deweight) -- `referenceSurface` stands in for the live
   * `surface` parameter (the surface of the match actually being predicted). Since a backtest
   * point isn't tied to any single upcoming prediction, the surface of the very next REAL match
   * the player went on to play (`future[0].surface`) is used -- that's the actual matchup this
   * trend read would have applied to. When that surface is unknown, the mismatch deweight is
   * skipped entirely (multiplier 1) rather than guessed, matching the live code's own null-check.
   */
  function fullWeightsFor(past: PlayerAppearance[], referenceSurface: string | null): number[] {
    return past.map((m, i) => {
      let weight = Math.pow(0.85, i);
      weight *= levelWeight(m.tournamentLevel);
      if (referenceSurface !== null && m.surface !== null && m.surface !== referenceSurface) weight *= SURFACE_MISMATCH_WEIGHT;
      if (m.retired || m.walkover) weight *= RETIRED_OR_WALKOVER_WEIGHT;
      return weight;
    });
  }

  const weightedAvg = (contributions: number[], weights: number[]) => {
    let sum = 0;
    let total = 0;
    contributions.forEach((c, i) => {
      sum += c * weights[i];
      total += weights[i];
    });
    return total > 0 ? sum / total : 0.5;
  };

  for (const signal of ["plain win-rate delta", "opponent-adjusted delta", "opponent+serveReturn-adjusted delta"] as const) {
    console.log(`\n=== Signal: ${signal} ===`);
    for (const candidate of CANDIDATES) {
      const buckets: Record<"improving" | "stable" | "declining", { n: number; futureWinRateSum: number }> = {
        improving: { n: 0, futureWinRateSum: 0 },
        stable: { n: 0, futureWinRateSum: 0 },
        declining: { n: 0, futureWinRateSum: 0 },
      };

      for (const list of byPlayer.values()) {
        for (let i = FUTURE_WINDOW; i < list.length; i++) {
          const past = list.slice(i, i + PAST_WINDOW);
          const future = list.slice(Math.max(0, i - FUTURE_WINDOW), i);
          if (future.length < MIN_FUTURE_SAMPLE || past.length === 0 || past.length < candidate.minSample) continue;

          const half = Math.ceil(past.length / 2);
          let delta: number;
          if (signal === "plain win-rate delta") {
            delta = winRate(past.slice(0, half)) - winRate(past.slice(half));
          } else {
            const referenceSurface = future[0]?.surface ?? null;
            const contributions = contributionsFor(past, signal === "opponent+serveReturn-adjusted delta");
            const weights = fullWeightsFor(past, referenceSurface);
            delta =
              weightedAvg(contributions.slice(0, half), weights.slice(0, half)) - weightedAvg(contributions.slice(half), weights.slice(half));
          }
          const label: "improving" | "stable" | "declining" = delta > candidate.deltaThreshold ? "improving" : delta < -candidate.deltaThreshold ? "declining" : "stable";

          buckets[label].n += 1;
          buckets[label].futureWinRateSum += winRate(future);
        }
      }

      console.log(`  ${candidate.label}:`);
      for (const label of ["improving", "stable", "declining"] as const) {
        const b = buckets[label];
        console.log(`    ${label}: n=${b.n}, avg future win rate=${b.n > 0 ? ((b.futureWinRateSum / b.n) * 100).toFixed(1) : "n/a"}%`);
      }
      const spread = buckets.improving.n > 0 && buckets.declining.n > 0 ? (buckets.improving.futureWinRateSum / buckets.improving.n - buckets.declining.futureWinRateSum / buckets.declining.n) * 100 : null;
      console.log(`    spread (improving - declining future win rate): ${spread !== null ? spread.toFixed(1) + "pts" : "n/a"}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
