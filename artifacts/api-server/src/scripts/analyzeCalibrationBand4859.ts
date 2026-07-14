// READ-ONLY calibration analysis for the near-coin-flip band (raw calibratedProbability 48-59,
// i.e. roughly the same margin<8 region that computeRecommendation now classifies as
// NO_STRONG_SIGNAL under HighDisagreement/Mixed). Answers two questions:
//   1) Is the model well-calibrated in this band, or systematically under/overconfident?
//   2) If underconfident, which specific input module's own signal is under-weighted relative to
//      how well it actually separates winners from losers in this band?
//
// Uses evaluation_predictions: historical_test/test-segment rows (genuinely out-of-sample
// walk-forward backtest, includes the newly-graded July 8-11 rows) UNION paper_trade/live graded
// rows (any other graded historical rows outside the walk-forward corpus). Validation-segment
// rows are deliberately excluded -- they're used for fitting calibration, not evaluating it.
//
// Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/analyzeCalibrationBand4859.ts
import { db, evaluationPredictionsTable, pool } from "@workspace/db";
import { and, eq, inArray, or } from "drizzle-orm";
import type { LiveFeatureSnapshot } from "../services/evaluation/types";
import type { ModelVote } from "../services/predictionEngine/ensemble";

const BAND_MIN = 48;
const BAND_MAX = 59; // exclusive upper bound, matches the task's "48-59%" framing

async function main(): Promise<void> {
  const rows = await db
    .select()
    .from(evaluationPredictionsTable)
    .where(
      or(
        and(eq(evaluationPredictionsTable.runKind, "historical_test"), eq(evaluationPredictionsTable.segment, "test")),
        inArray(evaluationPredictionsTable.runKind, ["paper_trade", "live"]),
      ),
    );

  const graded = rows.filter(
    (r) =>
      (r.status === "graded" || r.status === "void") &&
      r.includedInAccuracy &&
      r.calibratedProbability !== null &&
      r.actualWinnerId !== null &&
      r.featureSnapshot !== null,
  );
  console.log(`Graded, accuracy-eligible rows with a full engine snapshot: ${graded.length} / ${rows.length} total (test-segment historical_test + paper_trade/live)`);

  const dates = rows.map((r) => r.scheduledStartAt.getTime());
  console.log(`Date range covered: ${new Date(Math.min(...dates)).toISOString()} .. ${new Date(Math.max(...dates)).toISOString()}\n`);

  const band = graded.filter((r) => r.calibratedProbability! >= BAND_MIN && r.calibratedProbability! < BAND_MAX);
  console.log(`=== Band: raw calibratedProbability in [${BAND_MIN}, ${BAND_MAX}) -- n=${band.length} / ${graded.length} graded rows (${((band.length / graded.length) * 100).toFixed(1)}%) ===\n`);

  // --- 1) Overall calibration in the band, oriented to the PREDICTED WINNER (the "does a 55%
  // prediction win 55% of the time" framing) ---
  type BandRow = { row: (typeof band)[number]; winnerProb: number; favoriteWon: boolean };
  const oriented: BandRow[] = band.map((row) => {
    const p1 = row.calibratedProbability!;
    const winnerProb = Math.max(p1, 100 - p1);
    const favoriteWon = row.actualWinnerId === row.predictedWinnerId;
    return { row, winnerProb, favoriteWon };
  });

  const avgPredictedConfidence = oriented.reduce((s, o) => s + o.winnerProb, 0) / oriented.length;
  const observedFavoriteWinRate = (oriented.filter((o) => o.favoriteWon).length / oriented.length) * 100;
  console.log(`Average predicted confidence (favorite-oriented): ${avgPredictedConfidence.toFixed(1)}%`);
  console.log(`Observed favorite win rate:                       ${observedFavoriteWinRate.toFixed(1)}%`);
  console.log(`Gap (observed - predicted):                       ${(observedFavoriteWinRate - avgPredictedConfidence).toFixed(1)} points`);
  console.log(
    observedFavoriteWinRate - avgPredictedConfidence > 3
      ? `-> UNDERCONFIDENT: real outcomes separate more cleanly than the stated probability admits.`
      : observedFavoriteWinRate - avgPredictedConfidence < -3
        ? `-> OVERCONFIDENT: real outcomes are closer to a coin flip than the stated probability admits.`
        : `-> Roughly well-calibrated (within +/-3pts) in this band.`,
  );

  // --- 2) Finer sub-bins for resolution ---
  console.log(`\nSub-bin detail (favorite-oriented confidence):`);
  const subEdges = [50, 52, 54, 56, 58, 60];
  for (let i = 0; i < subEdges.length - 1; i++) {
    const lo = subEdges[i];
    const hi = subEdges[i + 1];
    const inBin = oriented.filter((o) => o.winnerProb >= lo && o.winnerProb < hi);
    if (inBin.length === 0) continue;
    const avgPred = inBin.reduce((s, o) => s + o.winnerProb, 0) / inBin.length;
    const obs = (inBin.filter((o) => o.favoriteWon).length / inBin.length) * 100;
    console.log(`  [${lo}-${hi}%): n=${inBin.length}, avgPredicted=${avgPred.toFixed(1)}%, observed=${obs.toFixed(1)}%, gap=${(obs - avgPred).toFixed(1)}`);
  }

  // --- 3) Raw (non-oriented, player1-relative) check for directional bias, matching the task's
  // literal 48-59 framing on calibratedProbability itself (not just favorite-oriented). ---
  const avgRawPredicted = band.reduce((s, r) => s + r.calibratedProbability!, 0) / band.length;
  const observedPlayer1WinRate = (band.filter((r) => r.actualWinnerId === r.player1Id).length / band.length) * 100;
  console.log(`\nRaw (player1-relative) check: avg predicted P(player1 wins)=${avgRawPredicted.toFixed(1)}%, observed player1 win rate=${observedPlayer1WinRate.toFixed(1)}% (checks for a directional bias toward/against player1, not just magnitude)`);

  // --- 4) Which module's own signal is under-weighted? For each core module, measure how well
  // ITS OWN vote (direction + magnitude) separates the actual winner within this exact band,
  // versus the average ensemble weight that module is actually given here. A module with strong
  // standalone accuracy but a small average weight is the under-weighting candidate. ---
  console.log(`\n=== Per-module signal strength vs. actual ensemble weight, within this band ===`);
  // Coverage-conditional: a module that votes exactly 50 (no real edge) is "no opinion", not
  // "wrong" -- counting it as a direction miss (as a naive >/< split would) understates modules
  // like Fatigue that are frequently silent by design. Only rows where the module expresses a
  // real (>0.5pt) edge count toward that module's standalone direction accuracy.
  const moduleStats = new Map<string, { n: number; withEdge: number; correctDirection: number; weightSum: number; avgAbsEdgeSum: number }>();

  for (const row of band) {
    const snapshot = row.featureSnapshot as unknown as LiveFeatureSnapshot;
    const models: ModelVote[] | undefined = snapshot?.engine?.models;
    if (!models) continue;
    const player1Won = row.actualWinnerId === row.player1Id;

    for (const m of models) {
      // Only the six core per-match feature modules -- skip specialist/simulator/general-blend
      // synthetic "models" that don't correspond to a single input feature.
      if (!["Surface Elo", "Serve & Return", "Recent Form", "Fatigue", "Availability", "Head-to-Head"].includes(m.modelName)) continue;
      const entry = moduleStats.get(m.modelName) ?? { n: 0, withEdge: 0, correctDirection: 0, weightSum: 0, avgAbsEdgeSum: 0 };
      entry.n += 1;
      entry.weightSum += m.weightUsed;
      entry.avgAbsEdgeSum += Math.abs(m.player1Probability - 50);
      const edge = m.player1Probability - 50;
      if (Math.abs(edge) > 0.5) {
        entry.withEdge += 1;
        const leanTowardPlayer1 = edge > 0;
        const correctlyLeaned = (leanTowardPlayer1 && player1Won) || (!leanTowardPlayer1 && !player1Won);
        if (correctlyLeaned) entry.correctDirection += 1;
      }
      moduleStats.set(m.modelName, entry);
    }
  }

  console.log(`  Module            | n     | coverage (real edge) | conditional direction accuracy | avg ensemble weight | avg |edge from 50|`);
  for (const [name, s] of moduleStats) {
    const coverage = (s.withEdge / s.n) * 100;
    const conditionalAccuracy = s.withEdge > 0 ? (s.correctDirection / s.withEdge) * 100 : null;
    const avgWeight = s.weightSum / s.n;
    const avgEdge = s.avgAbsEdgeSum / s.n;
    console.log(
      `  ${name.padEnd(18)} | ${String(s.n).padEnd(5)} | ${coverage.toFixed(1).padStart(5)}%               | ${(conditionalAccuracy === null ? "n/a" : conditionalAccuracy.toFixed(1) + "%").padStart(6)}                          | ${(avgWeight * 100).toFixed(1).padStart(5)}%              | ${avgEdge.toFixed(2)}`,
    );
  }

  // Ensemble's own standalone direction accuracy in the band, for comparison.
  const ensembleCorrect = oriented.filter((o) => o.favoriteWon).length;
  console.log(`\n  Ensemble (blended, actually used) direction accuracy: ${((ensembleCorrect / oriented.length) * 100).toFixed(1)}% (n=${oriented.length})`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
