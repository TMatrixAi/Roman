/**
 * One-shot script: fit calibration + specialist models from existing validation
 * predictions already in evaluation_predictions (run_kind=historical_test, segment=validation).
 *
 * Run with: pnpm exec tsx scripts/postWalkForwardFit.ts
 *
 * Use when a walk-forward completes scoring but the post-fold fitting steps were
 * interrupted (e.g. server restart mid-run). The validation predictions are already
 * in the DB; this script just fits the models from them.
 */
import { db, evaluationPredictionsTable, calibrationModelsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { fitBestCalibration } from "../src/services/evaluation/calibration";
import { computeAndStoreSpecialistSegments } from "../src/services/evaluation/specialistWeights";
import type { CalibrationPoint } from "../src/services/evaluation/calibration";

async function main() {
  // 1. Load accuracy-eligible validation predictions from the DB.
  //    raw_probability is stored as 0–100 in the DB (the engine works in fractions,
  //    but the storage multiplies by 100 for integer precision). Divide by 100 here
  //    to recover the 0–1 fraction that fitBestCalibration expects.
  console.log("Loading validation predictions from DB...");
  const rows = await db
    .select({
      rawProbability: evaluationPredictionsTable.rawProbability,
      player1Id: evaluationPredictionsTable.player1Id,
      actualWinnerId: evaluationPredictionsTable.actualWinnerId,
    })
    .from(evaluationPredictionsTable)
    .where(
      and(
        eq(evaluationPredictionsTable.runKind, "historical_test"),
        eq(evaluationPredictionsTable.segment, "validation"),
        eq(evaluationPredictionsTable.includedInAccuracy, true),
      ),
    );

  console.log(`  Found ${rows.length} accuracy-eligible validation rows`);

  const points: CalibrationPoint[] = rows
    .filter((r) => r.rawProbability !== null && r.actualWinnerId !== null)
    .map((r) => ({
      rawProbability: (r.rawProbability as number) / 100,
      outcome: (r.actualWinnerId === r.player1Id ? 1 : 0) as 0 | 1,
    }));

  console.log(`  ${points.length} calibration points after null filtering`);

  if (points.length < 200) {
    throw new Error(`Too few calibration points (${points.length}) — need ≥200 to fit reliably`);
  }

  // 2. Fit the best calibration model (isotonic vs Platt, winner by holdout log-loss).
  console.log("Fitting calibration model (isotonic vs Platt)...");
  const liveFit = fitBestCalibration(points);
  console.log(`  Selected method : ${liveFit.method}`);
  console.log(`  Isotonic LL     : ${liveFit.isotonicHoldoutLogLoss?.toFixed(5)}`);
  console.log(`  Platt LL        : ${liveFit.plattHoldoutLogLoss?.toFixed(5)}`);
  console.log(`  Holdout size    : ${liveFit.holdoutSampleSize}`);
  console.log(`  Knots           : ${liveFit.knots.length}`);

  // 3. Get the date range from the validation window.
  const [dateRange] = await db
    .select({
      minDate: sql<string>`min(scheduled_start_at)`,
      maxDate: sql<string>`max(scheduled_start_at)`,
    })
    .from(evaluationPredictionsTable)
    .where(
      and(
        eq(evaluationPredictionsTable.runKind, "historical_test"),
        eq(evaluationPredictionsTable.segment, "validation"),
      ),
    );

  // 4. Store the new calibration model, replacing the current active one.
  console.log("Storing calibration model...");
  await db.update(calibrationModelsTable).set({ active: false }).where(eq(calibrationModelsTable.active, true));
  const [newModel] = await db
    .insert(calibrationModelsTable)
    .values({
      method: liveFit.method,
      mapping: liveFit.knots,
      validationSampleSize: points.length,
      validationDateRangeStart: dateRange?.minDate ? new Date(dateRange.minDate) : null,
      validationDateRangeEnd: dateRange?.maxDate ? new Date(dateRange.maxDate) : null,
      active: true,
      isotonicHoldoutLogLoss: liveFit.isotonicHoldoutLogLoss,
      plattHoldoutLogLoss: liveFit.plattHoldoutLogLoss,
      holdoutSampleSize: liveFit.holdoutSampleSize,
    })
    .returning({ id: calibrationModelsTable.id });
  console.log(`  Calibration model stored (id=${newModel.id})`);

  // 5. Compute specialist segment models from the same validation predictions.
  //    computeAndStoreSpecialistSegments re-queries evaluation_predictions internally,
  //    filtering by tour/surface using the new TOUR_LEVEL_DB_VALUES normalization.
  console.log("Computing specialist segment models...");
  await computeAndStoreSpecialistSegments(liveFit.knots);
  console.log("  Specialist models computed and stored");

  // 6. Report what was produced.
  const { default: dbImport, specialistModelsTable } = await import("@workspace/db");
  const specialists = await db.select().from(specialistModelsTable);
  const active = specialists.filter((s) => s.meetsThreshold);
  const below = specialists.filter((s) => !s.meetsThreshold);
  console.log(`\nResults:`);
  console.log(`  Specialist segments total  : ${specialists.length}`);
  console.log(`  Meets threshold (active)   : ${active.length}`);
  console.log(`  Below threshold            : ${below.length}`);
  if (active.length > 0) {
    console.log(`  Active segments:`);
    for (const s of active) {
      console.log(`    ${s.segmentKey}  hist=${s.historicalMatchCount}  val=${s.validationSampleSize}  acc=${(s.accuracy ?? 0).toFixed(3)}`);
    }
  }
  console.log("\nDone.");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
