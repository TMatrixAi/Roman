// One-off, expensive batch analysis (per `follow-up-tasks`/spec conventions this is NOT re-run
// casually). Reads every finished historical match in chronological order, and for each player's
// appearance in a match with enough real history on both sides (a prior window to label a trend,
// a future window to check what actually happened next), computes a candidate trend label under
// several threshold/min-sample configurations and compares it against that player's REAL
// subsequent win rate. This is the calibration basis for the improving/stable/declining
// thresholds hardcoded in `recentForm.ts` -- run once, results transcribed into code with this
// script's output as the citation (2026-07-13 Recent Form recalibration).
//
// Two delta signals are compared:
//   1. Plain win-rate delta (the pre-existing recentForm.ts logic) -- newer-half win rate minus
//      older-half win rate, no opponent adjustment.
//   2. Opponent-adjusted performance delta -- same newer/older split, but each match contributes
//      (actualScore - expectedScoreVsOpponent) using the same real eloOverall history the live
//      engine's opponent-adjustment already relies on (see `opponentStrength.ts`), falling back
//      to plain win/loss when an opponent's Elo was never resolved. This is expected to separate
//      genuine form swings from streaks that are really just "faced weaker/stronger opponents".
//
// Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/analyzeRecentFormTrendValidity.ts
import { db, historicalMatchesTable, matchFeatureSnapshotsTable, pool } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

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

type PlayerAppearance = { won: boolean; opponentId: string; date: number };

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

  const byPlayer = new Map<string, PlayerAppearance[]>();
  for (const m of rows) {
    if (m.cancelled) continue;
    const p1Won = m.winnerId === m.player1Id;
    const t = m.scheduledStartAt.getTime();
    const push = (playerId: string, opponentId: string, won: boolean) => {
      const list = byPlayer.get(playerId) ?? [];
      list.push({ won, opponentId, date: t });
      byPlayer.set(playerId, list);
    };
    push(m.player1Id, m.player2Id, p1Won);
    push(m.player2Id, m.player1Id, !p1Won);
  }
  for (const list of byPlayer.values()) list.reverse(); // most-recent-first, matching the live module's convention
  console.log(`Tracked ${byPlayer.size} distinct players`);

  const winRate = (arr: PlayerAppearance[]) => (arr.length ? arr.filter((m) => m.won).length / arr.length : 0.5);

  function contributionsFor(past: PlayerAppearance[]): number[] {
    return past.map((m) => {
      const expected = expectedScoreVs(m.opponentId, m.date, eloHistory);
      const actual = m.won ? 1 : 0;
      return expected !== null ? 0.5 + (actual - expected) / 2 : actual;
    });
  }
  const weightedAvg = (contributions: number[]) => {
    let sum = 0;
    let total = 0;
    contributions.forEach((c, i) => {
      const w = Math.pow(0.85, i);
      sum += c * w;
      total += w;
    });
    return total > 0 ? sum / total : 0.5;
  };

  for (const signal of ["plain win-rate delta", "opponent-adjusted delta"] as const) {
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
            const contributions = contributionsFor(past);
            delta = weightedAvg(contributions.slice(0, half)) - weightedAvg(contributions.slice(half));
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
