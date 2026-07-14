// Diagnostic for Task #66: the near-Elite backtest group (every real Elite gate met except
// segment-specialist support -- see eliteTierBacktest.ts) is flagged MISCALIBRATED on the
// Accuracy dashboard (ECE calibrated ~0.117, ~56% accuracy on n=425) despite meeting the same
// "high data quality + all three primary signals agree + no model conflict + no High
// Disagreement/High-or-Extreme upset risk" bar real Elite tier uses. This script reproduces the
// exact same classification (`classifyEliteTierRow`) against real graded rows and breaks the
// cohort down to isolate WHY it's overconfident: is it driven by the data-quality gate alone, the
// "three signals agree" gate alone, or specifically the intersection of both (the actual Elite/
// near-Elite bar)?
//
// Findings and the fix this script's output supports are written up in
// ../services/evaluation/NEAR_ELITE_ECE_INVESTIGATION.md -- the short version: this cohort is
// dominated by near-coin-flip matches (signal agreement checks DIRECTION only, not magnitude),
// which is what `ELITE_MIN_CALIBRATED_MARGIN` (eliteTier.ts) now filters for.
//
// Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/analyzeNearEliteOverconfidence.ts
import { db, evaluationPredictionsTable, pool, type EvaluationPredictionRow } from "@workspace/db";
import { and, inArray } from "drizzle-orm";
import { classifyEliteTierRow } from "../services/evaluation/eliteTierBacktest";
import { computeSegmentMetrics } from "../services/evaluation/metrics";
import type { LiveFeatureSnapshot } from "../services/evaluation/types";
import type { EngineBreakdown } from "../services/predictionEngine";
import { voteFavorsPlayer1 } from "../services/predictionEngine/eliteTier";

function extractEngine(row: EvaluationPredictionRow): EngineBreakdown | null {
  const snapshot = row.featureSnapshot as unknown as Partial<LiveFeatureSnapshot> | null;
  const engine = snapshot?.engine as EngineBreakdown | undefined;
  if (!engine || !Array.isArray(engine.models)) return null;
  return engine;
}

async function fetchRows(): Promise<EvaluationPredictionRow[]> {
  return db
    .select()
    .from(evaluationPredictionsTable)
    .where(
      and(
        inArray(evaluationPredictionsTable.runKind, ["historical_test", "paper_trade", "live"]),
        inArray(evaluationPredictionsTable.status, ["graded", "void"]),
      ),
    );
}

async function main(): Promise<void> {
  const allRows = await fetchRows();
  // Mirror the dashboard's own scoping: historical_test/test-segment + paper_trade/live, never
  // the validation segment (used to fit calibration) -- see routes/evaluation.ts.
  const rows = allRows.filter((r) => (r.runKind === "historical_test" ? r.segment === "test" : true));
  console.log(`Total genuinely-unseen graded/void rows: ${rows.length}`);

  const nearEliteRows = rows.filter((r) => classifyEliteTierRow(r).isNearElite);
  const eliteRows = rows.filter((r) => classifyEliteTierRow(r).isElite);
  console.log(`near-Elite: n=${nearEliteRows.length}, real Elite: n=${eliteRows.length}`);

  const nearEliteMetrics = computeSegmentMetrics(nearEliteRows);
  console.log("\nnear-Elite metrics (reproduction check):", JSON.stringify(nearEliteMetrics, null, 2));

  // Decompose the near-Elite gate into its two components: dataQuality>=65 alone, and "all three
  // signals agree" alone, each scored independently against the WHOLE unseen pool -- to see which
  // one (or their intersection) actually drives the overconfidence, rather than assuming it's the
  // combination just because that's the gate we happened to define.
  type Row = (typeof rows)[number];
  const dqHighOnly: Row[] = [];
  const allAgreeOnly: Row[] = [];
  const bothGates: Row[] = [];
  const neitherGate: Row[] = [];

  for (const row of rows) {
    const engine = extractEngine(row);
    if (!engine) continue;
    const snapshot = row.featureSnapshot as unknown as Partial<LiveFeatureSnapshot>;
    const dataQuality = snapshot.dataQuality;
    if (typeof dataQuality !== "number") continue;

    const surfaceElo = voteFavorsPlayer1(engine.models, "Surface Elo");
    const serveReturn = voteFavorsPlayer1(engine.models, "Serve & Return");
    const recentForm = voteFavorsPlayer1(engine.models, "Recent Form");
    const allAgree = surfaceElo === serveReturn && serveReturn === recentForm;
    const dqHigh = dataQuality >= 65;

    if (dqHigh && allAgree) bothGates.push(row);
    else if (dqHigh) dqHighOnly.push(row);
    else if (allAgree) allAgreeOnly.push(row);
    else neitherGate.push(row);
  }

  const report = (label: string, group: Row[]) => {
    const metrics = computeSegmentMetrics(group);
    console.log(`\n${label}: n=${metrics.n}, accuracy=${metrics.accuracy}%, logLoss=${metrics.logLoss}, eceCalibrated=${metrics.eceCalibrated}, eceRaw=${metrics.eceRaw}`);
  };
  report("dataQuality>=65 AND all-3-agree (this IS the near-Elite/Elite signal gate)", bothGates);
  report("dataQuality>=65 only (all-3-agree NOT required)", dqHighOnly);
  report("all-3-agree only (dataQuality NOT required >=65)", allAgreeOnly);
  report("neither gate", neitherGate);

  // Within the near-Elite cohort itself, break down by raw-probability confidence band to see
  // WHERE the miscalibration concentrates (e.g. only the most extreme 80%+ band, or spread evenly).
  console.log("\nWithin near-Elite: accuracy by raw-probability confidence band (distance from 50 toward the pick):");
  const bandEdges: [number, number, string][] = [
    [50, 60, "50-60%"],
    [60, 70, "60-70%"],
    [70, 80, "70-80%"],
    [80, 100, "80-100%"],
  ];
  for (const [min, max, label] of bandEdges) {
    const inBand = nearEliteRows.filter((r) => {
      if (r.rawProbability === null) return false;
      const confidence = Math.max(r.rawProbability, 100 - r.rawProbability);
      return confidence >= min && confidence < max;
    });
    const correct = inBand.filter((r) => r.actualWinnerId === r.predictedWinnerId).length;
    const avgRaw = inBand.length > 0 ? inBand.reduce((s, r) => s + Math.max(r.rawProbability!, 100 - r.rawProbability!), 0) / inBand.length : null;
    const avgCalibrated = inBand.length > 0 ? inBand.reduce((s, r) => s + Math.max(r.calibratedProbability!, 100 - r.calibratedProbability!), 0) / inBand.length : null;
    console.log(
      `  ${label}: n=${inBand.length}, avgRawConfidence=${avgRaw?.toFixed(1)}, avgCalibratedConfidence=${avgCalibrated?.toFixed(1)}, observedAccuracy=${inBand.length > 0 ? ((correct / inBand.length) * 100).toFixed(1) : "n/a"}%`,
    );
  }

  // Compare near-Elite's raw vs calibrated confidence to the REST of the unseen pool at the same
  // raw-confidence level -- if near-Elite rows run systematically hotter (higher raw confidence)
  // than same-bucket non-near-Elite rows without a correspondingly higher accuracy, that's the
  // "agreement looks like independent evidence but isn't" selection effect.
  const restRows = rows.filter((r) => !nearEliteRows.includes(r) && !eliteRows.includes(r));
  console.log("\nRest-of-pool (not near-Elite, not Elite) accuracy by the SAME raw-probability confidence bands:");
  for (const [min, max, label] of bandEdges) {
    const inBand = restRows.filter((r) => {
      if (r.rawProbability === null) return false;
      const confidence = Math.max(r.rawProbability, 100 - r.rawProbability);
      return confidence >= min && confidence < max;
    });
    const correct = inBand.filter((r) => r.actualWinnerId === r.predictedWinnerId).length;
    console.log(`  ${label}: n=${inBand.length}, observedAccuracy=${inBand.length > 0 ? ((correct / inBand.length) * 100).toFixed(1) : "n/a"}%`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
