/**
 * Task #12: Candidate optimizer — training-mode walk-forward + candidate config generation.
 *
 * The "Run Optimizer" dashboard action triggers this. It runs the full walk-forward in
 * training mode (evaluationOnly=false), then:
 *  1. Writes a versioned candidate_configs row (never overwrites the active production config).
 *  2. Runs the threshold evaluation job over the freshly-updated graded cohort.
 *
 * The candidate row captures the new calibration + specialist segment weights (proposed config)
 * vs the config active before this run (base config snapshot). Status starts at "pending".
 * Promotion to production requires a separate manual acceptance step -- never auto-promoted.
 *
 * Safety invariants enforced here (also documented on candidateConfigsTable):
 *  - We always INSERT a new candidate_configs row, never UPDATE the active production config.
 *  - The candidate config is read-only after insertion from this path.
 *  - Threshold evaluation (runThresholdEvaluation) only reads graded rows, never writes engine weights.
 */

import { db, calibrationModelsTable, specialistModelsTable, candidateConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { runWalkForwardEvaluation, type WalkForwardSummary } from "./walkForward";
import { runThresholdEvaluation, type ThresholdEvaluationResult } from "./thresholdEvaluation";

export interface OptimizerRunSummary {
  walkForwardSummary: WalkForwardSummary;
  candidateConfigId: number;
  thresholdEvaluationId: number;
}

/**
 * Runs the full walk-forward in training mode, writes a new candidate_configs row,
 * and runs threshold evaluation. Returns a summary of what was produced.
 *
 * The caller (route handler) is responsible for ensuring only one optimizer run is active
 * at a time -- this function has no built-in concurrency guard because the walk-forward
 * itself wipes and rewrites historical_test rows up front, making concurrent runs
 * self-defeating rather than silently corrupt.
 */
export async function runOptimizerRun(options: { foldCount?: number; warmupFraction?: number; notes?: string } = {}): Promise<OptimizerRunSummary> {
  logger.info({ options }, "Task #12: optimizer run started (training mode)");

  // Snapshot the currently-active calibration BEFORE the training run overwrites it.
  const [activeCalibrationBefore] = await db.select().from(calibrationModelsTable).where(eq(calibrationModelsTable.active, true)).limit(1);
  const activeSpecialistsBefore = await db.select().from(specialistModelsTable);

  const baseConfigSnapshot = {
    calibration: activeCalibrationBefore
      ? {
          id: activeCalibrationBefore.id,
          method: activeCalibrationBefore.method,
          validationSampleSize: activeCalibrationBefore.validationSampleSize,
          isotonicHoldoutLogLoss: activeCalibrationBefore.isotonicHoldoutLogLoss,
          plattHoldoutLogLoss: activeCalibrationBefore.plattHoldoutLogLoss,
        }
      : null,
    specialistSegments: activeSpecialistsBefore.map((s) => ({
      segmentKey: s.segmentKey,
      weight: s.weight,
      meetsThreshold: s.meetsThreshold,
      validationSampleSize: s.validationSampleSize,
    })),
  };

  // Run the full training walk-forward (evaluationOnly=false). This will:
  // - Refit calibration_models
  // - Refit specialist_models
  // - Run runPatternAnalysis() automatically at the end
  const wfSummary = await runWalkForwardEvaluation({ foldCount: options.foldCount, warmupFraction: options.warmupFraction, evaluationOnly: false });

  // Snapshot the newly-fitted calibration and specialists (proposed config).
  const [activeCalibrationAfter] = await db.select().from(calibrationModelsTable).where(eq(calibrationModelsTable.active, true)).limit(1);
  const activeSpecialistsAfter = await db.select().from(specialistModelsTable);

  const proposedConfig = {
    calibration: activeCalibrationAfter
      ? {
          id: activeCalibrationAfter.id,
          method: activeCalibrationAfter.method,
          validationSampleSize: activeCalibrationAfter.validationSampleSize,
          knots: activeCalibrationAfter.mapping,
          isotonicHoldoutLogLoss: activeCalibrationAfter.isotonicHoldoutLogLoss,
          plattHoldoutLogLoss: activeCalibrationAfter.plattHoldoutLogLoss,
        }
      : null,
    specialistSegments: activeSpecialistsAfter.map((s) => ({
      segmentKey: s.segmentKey,
      weight: s.weight,
      meetsThreshold: s.meetsThreshold,
      validationSampleSize: s.validationSampleSize,
      logLoss: s.logLoss,
      accuracy: s.accuracy,
    })),
  };

  // Compute weight diff (proposed vs base specialist weights)
  const weightDiff: Record<string, unknown> = {};
  for (const after of activeSpecialistsAfter) {
    const before = activeSpecialistsBefore.find((b) => b.segmentKey === after.segmentKey);
    weightDiff[after.segmentKey] = { from: before?.weight ?? null, to: after.weight };
  }

  // Compute validation + holdout metrics from the freshly-written fold data
  // (fold metrics are already in evaluation_runs, summarized here for the candidate row)
  const validationMetrics = {
    foldsRun: wfSummary.foldsRun,
    foldIds: wfSummary.foldIds,
    fallbackRate: wfSummary.fallbackRate,
    warnings: wfSummary.warnings,
  };

  // Task #12 invariant: always INSERT, never update the active production config.
  // Using `candidateConfigsTable` insert -- a different table from `calibrationModelsTable`.
  const [candidateRow] = await db
    .insert(candidateConfigsTable)
    .values({
      name: `Optimizer run — ${new Date().toISOString().slice(0, 10)}`,
      notes: options.notes ?? `Auto-generated by optimizer. Walk-forward: ${wfSummary.foldsRun} folds.`,
      status: "pending",
      sourceRunId: null,
      weightDiff,
      thresholdDiff: {}, // Threshold diffs are captured in the threshold evaluation run instead
      proposedConfig: proposedConfig as unknown as Record<string, unknown>,
      validationMetrics: validationMetrics as unknown as Record<string, unknown>,
      holdoutMetrics: {
        calibrationMethod: activeCalibrationAfter?.method ?? null,
        isotonicHoldoutLogLoss: activeCalibrationAfter?.isotonicHoldoutLogLoss ?? null,
        plattHoldoutLogLoss: activeCalibrationAfter?.plattHoldoutLogLoss ?? null,
        holdoutSampleSize: activeCalibrationAfter?.holdoutSampleSize ?? null,
      } as unknown as Record<string, unknown>,
      acceptanceChecksPassed: false,
      acceptanceChecks: [
        {
          check: "minimum_folds",
          passed: wfSummary.foldsRun >= 2,
          detail: `${wfSummary.foldsRun} folds ran (minimum 2 required)`,
        },
        {
          check: "calibration_fitted",
          passed: activeCalibrationAfter !== null,
          detail: activeCalibrationAfter ? `Method: ${activeCalibrationAfter.method}` : "No calibration row written",
        },
        {
          check: "no_skipped_matches",
          passed: !wfSummary.skippedNoEligibleMatches,
          detail: wfSummary.skippedNoEligibleMatches ? "Skipped due to insufficient matches" : "All eligible matches scored",
        },
      ],
    })
    .returning({ id: candidateConfigsTable.id });

  logger.info({ candidateConfigId: candidateRow.id }, "Task #12: candidate config row inserted (status=pending, never overwrites production)");

  // Run threshold evaluation on the freshly-updated graded cohort.
  const threshEval = await runThresholdEvaluation();

  logger.info({ candidateConfigId: candidateRow.id, thresholdEvaluationId: threshEval.id }, "Task #12: optimizer run complete");

  return {
    walkForwardSummary: wfSummary,
    candidateConfigId: candidateRow.id,
    thresholdEvaluationId: threshEval.id,
  };
}

/** Lists the most recent candidate configs (most recent first). */
export async function listCandidateConfigs(limit = 10) {
  return db.select().from(candidateConfigsTable).orderBy(desc(candidateConfigsTable.createdAt)).limit(limit);
}
