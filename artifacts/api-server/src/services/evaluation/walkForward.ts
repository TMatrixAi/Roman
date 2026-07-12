import { db, evaluationPredictionsTable, evaluationRunsTable, calibrationModelsTable, historicalMatchesTable } from "@workspace/db";
import { asc, eq, inArray } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { fitIsotonicCalibration, applyCalibration, type CalibrationPoint } from "./calibration";
import { scoreHistoricalMatch, type HistoricalScoringContext } from "./historicalScoring";
import { getPredictionSettings } from "./settle";
import { computeAndStoreSpecialistSegments } from "./specialistWeights";
import { buildMatchHistoryIndex } from "../historicalData/matchRecordReconstruction";
import { buildEloHistoryIndex } from "../predictionEngine/opponentStrength";
import { HISTORICAL_MODEL_VERSION, type ResultType, type RetirementRule } from "./types";
import type { CalibrationKnot } from "./types";

export interface WalkForwardOptions {
  /** Number of expanding-window folds to run over the back portion of the timeline. */
  foldCount?: number;
  /** Fraction of the earliest history reserved as train-only warmup, never scored. */
  warmupFraction?: number;
}

export interface WalkForwardSummary {
  foldsRun: number;
  foldIds: number[];
  skippedNoEligibleMatches: boolean;
}

function classifyResult(match: { winnerId: string | null; retired: boolean; walkover: boolean; cancelled: boolean }): ResultType {
  if (match.cancelled) return "cancelled";
  if (match.walkover) return "walkover";
  if (match.retired) return "retired";
  return "normal";
}

/**
 * Runs a fresh sequence of expanding-window walk-forward folds over the entire leak-proof
 * historical store and persists per-fold results. Each run supersedes prior evaluation_runs /
 * evaluation_predictions rows of runKind='historical_test' (deleted up front) so re-running
 * after a model change never mixes stale and fresh fold results together.
 */
export async function runWalkForwardEvaluation(options: WalkForwardOptions = {}): Promise<WalkForwardSummary> {
  const foldCount = options.foldCount ?? 4;
  const warmupFraction = options.warmupFraction ?? 0.4;
  if (foldCount < 1) throw new Error("foldCount must be >= 1");
  if (warmupFraction <= 0 || warmupFraction >= 1) throw new Error("warmupFraction must be between 0 and 1 (exclusive)");

  const settings = await getPredictionSettings();

  const allMatches = await db
    .select()
    .from(historicalMatchesTable)
    .orderBy(asc(historicalMatchesTable.scheduledStartAt), asc(historicalMatchesTable.id));

  const eligible = allMatches.filter((m) => !m.cancelled); // cancelled matches never even reach scoring; walkovers/retirements are scored but voided/flagged downstream
  if (eligible.length < 20) {
    logger.warn({ count: eligible.length }, "Not enough historical matches to run a meaningful walk-forward evaluation");
    return { foldsRun: 0, foldIds: [], skippedNoEligibleMatches: true };
  }

  // Wipe prior historical_test evaluation state so a re-run never mixes fold generations.
  await db.delete(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.runKind, "historical_test"));
  await db.delete(evaluationRunsTable);

  // Preload the whole corpus ONCE for this run -- a run scores thousands of matches, each
  // needing two players' full prior histories, their H2H, and opponent-Elo lookups. Re-querying
  // the DB per match would turn a run that should take seconds into one that takes hours; see
  // `HistoricalScoringContext`.
  const scoringContext: HistoricalScoringContext = {
    matchHistory: buildMatchHistoryIndex(allMatches),
    eloHistory: await buildEloHistoryIndex(),
  };

  const warmupEndIdx = Math.floor(eligible.length * warmupFraction);
  const scorable = eligible.slice(warmupEndIdx);
  if (scorable.length < foldCount * 6) {
    logger.warn({ scorable: scorable.length, foldCount }, "Not enough post-warmup matches for the requested fold count");
    return { foldsRun: 0, foldIds: [], skippedNoEligibleMatches: true };
  }

  const chunkSize = Math.floor(scorable.length / foldCount);
  const foldIds: number[] = [];
  const allValidationPoints: CalibrationPoint[] = [];

  for (let fold = 0; fold < foldCount; fold++) {
    const chunkStart = fold * chunkSize;
    const chunkEnd = fold === foldCount - 1 ? scorable.length : chunkStart + chunkSize;
    const chunk = scorable.slice(chunkStart, chunkEnd);
    if (chunk.length < 4) continue;

    const half = Math.floor(chunk.length / 2);
    const validationMatches = chunk.slice(0, half);
    const testMatches = chunk.slice(half);

    const trainEnd = validationMatches[0].scheduledStartAt;
    const validationStart = validationMatches[0].scheduledStartAt;
    const validationEnd = validationMatches[validationMatches.length - 1].scheduledStartAt;
    const testStart = testMatches[0]?.scheduledStartAt ?? validationEnd;
    const testEnd = testMatches[testMatches.length - 1]?.scheduledStartAt ?? validationEnd;
    const trainStart = allMatches[0].scheduledStartAt;

    const validationRows = await scoreAndInsert(validationMatches, "validation", null, settings.retirementRule as RetirementRule);
    // Fit calibration ONLY on this fold's validation-segment, accuracy-eligible points.
    const foldValidationPoints: CalibrationPoint[] = validationRows
      .filter((r) => r.includedInAccuracy && r.rawProbability !== null)
      .map((r) => ({ rawProbability: r.rawProbability as number, outcome: r.player1Won ? 1 : 0 }));
    const mapping = fitIsotonicCalibration(foldValidationPoints);
    allValidationPoints.push(...foldValidationPoints);

    // Re-apply the fold's own calibration to its validation rows (in-sample, documented as such)
    // and to its test rows (out-of-sample -- test data was never touched while fitting `mapping`).
    await recalibrateRows(validationRows.map((r) => r.id), mapping);
    const testRows = await scoreAndInsert(testMatches, "test", null, settings.retirementRule as RetirementRule);
    await recalibrateRows(testRows.map((r) => r.id), mapping);

    const [insertedFold] = await db
      .insert(evaluationRunsTable)
      .values({
        foldIndex: fold,
        modelVersion: HISTORICAL_MODEL_VERSION,
        trainStart,
        trainEnd,
        validationStart,
        validationEnd,
        testStart,
        testEnd,
        calibrationMapping: mapping,
        validationMetrics: await summarizeSegment("historical_test", "validation", null),
        testMetrics: {},
      })
      .returning({ id: evaluationRunsTable.id });

    // Backfill foldId + fold-scoped metrics now that we have the fold's id.
    await db
      .update(evaluationPredictionsTable)
      .set({ foldId: insertedFold.id })
      .where(inArray(evaluationPredictionsTable.id, [...validationRows.map((r) => r.id), ...testRows.map((r) => r.id)]));

    await db
      .update(evaluationRunsTable)
      .set({
        validationMetrics: await summarizeSegment("historical_test", "validation", insertedFold.id),
        testMetrics: await summarizeSegment("historical_test", "test", insertedFold.id),
      })
      .where(eq(evaluationRunsTable.id, insertedFold.id));

    foldIds.push(insertedFold.id);
  }

  // Refit the single "live" calibration model from every fold's pooled validation data -- this
  // is what future paper-trade/live predictions will be calibrated with.
  await db.update(calibrationModelsTable).set({ active: false }).where(eq(calibrationModelsTable.active, true));
  const liveMapping = fitIsotonicCalibration(allValidationPoints);
  const dates = allMatches.map((m) => m.scheduledStartAt.getTime());
  await db.insert(calibrationModelsTable).values({
    method: "isotonic",
    mapping: liveMapping,
    validationSampleSize: allValidationPoints.length,
    validationDateRangeStart: dates.length ? new Date(Math.min(...dates)) : null,
    validationDateRangeEnd: dates.length ? new Date(Math.max(...dates)) : null,
    active: true,
  });

  // Phase 6: recompute every tour/surface specialist segment from the fold's freshly-written
  // validation-segment data, comparing each against this SAME newly-fit general/pooled mapping.
  await computeAndStoreSpecialistSegments(liveMapping);

  return { foldsRun: foldIds.length, foldIds, skippedNoEligibleMatches: false };

  // --- helpers (closures over allMatches context) ---

  async function scoreAndInsert(
    matches: (typeof allMatches)[number][],
    segment: "validation" | "test",
    foldId: number | null,
    retirementRule: RetirementRule,
  ): Promise<Array<{ id: number; rawProbability: number | null; player1Won: boolean; includedInAccuracy: boolean }>> {
    const results: Array<{ id: number; rawProbability: number | null; player1Won: boolean; includedInAccuracy: boolean }> = [];

    for (const match of matches) {
      const resultType = classifyResult(match);
      const isVoid = resultType === "walkover" || resultType === "cancelled";
      const player1Won = match.winnerId === match.player1Id;

      const scored = scoreHistoricalMatch(match, scoringContext);
      const rawProbability = scored?.rawProbability ?? null;
      const predictedWinnerId = rawProbability !== null ? (rawProbability >= 0.5 ? match.player1Id : match.player2Id) : null;
      const includedInAccuracy = !isVoid && (resultType === "normal" || retirementRule === "included") && rawProbability !== null;

      const [inserted] = await db
        .insert(evaluationPredictionsTable)
        .values({
          runKind: "historical_test",
          foldId,
          segment,
          historicalMatchId: match.id,
          player1Id: match.player1Id,
          player1Name: match.player1Name,
          player2Id: match.player2Id,
          player2Name: match.player2Name,
          surface: match.surface,
          matchFormat: match.matchFormat,
          tournamentLevel: match.tournamentLevel,
          tournamentName: match.tournamentName,
          scheduledStartAt: match.scheduledStartAt,
          cutoffAt: match.cutoffAt,
          lockedAt: new Date(),
          modelVersion: HISTORICAL_MODEL_VERSION,
          featureSnapshot: scored?.snapshot ?? null,
          rawProbability: rawProbability !== null ? rawProbability * 100 : null,
          calibratedProbability: rawProbability !== null ? rawProbability * 100 : null,
          predictedWinnerId,
          predictedWinnerName: predictedWinnerId ? (predictedWinnerId === match.player1Id ? match.player1Name : match.player2Name) : null,
          status: rawProbability === null ? "void" : isVoid ? "void" : "graded",
          actualWinnerId: match.winnerId,
          actualWinnerName: match.winnerId
            ? match.winnerId === match.player1Id
              ? match.player1Name
              : match.player2Name
            : null,
          resultType: rawProbability === null ? null : resultType,
          includedInAccuracy,
          gradedAt: new Date(),
        })
        .returning({ id: evaluationPredictionsTable.id });

      results.push({ id: inserted.id, rawProbability, player1Won, includedInAccuracy });
    }

    return results;
  }

  async function recalibrateRows(ids: number[], mapping: CalibrationKnot[]): Promise<void> {
    if (ids.length === 0) return;
    const rows = await db
      .select({ id: evaluationPredictionsTable.id, rawProbability: evaluationPredictionsTable.rawProbability })
      .from(evaluationPredictionsTable)
      .where(inArray(evaluationPredictionsTable.id, ids));

    for (const row of rows) {
      if (row.rawProbability === null) continue;
      const calibrated = applyCalibration(mapping, row.rawProbability / 100) * 100;
      await db
        .update(evaluationPredictionsTable)
        .set({ calibratedProbability: calibrated })
        .where(eq(evaluationPredictionsTable.id, row.id));
    }
  }

  async function summarizeSegment(_runKind: string, segment: string, foldId: number | null) {
    const { computeSegmentMetrics } = await import("./metrics");
    if (foldId === null) return computeSegmentMetrics([]);
    const rows = await db.select().from(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.foldId, foldId));
    const filtered = rows.filter((r) => r.segment === segment);
    return computeSegmentMetrics(filtered);
  }
}
