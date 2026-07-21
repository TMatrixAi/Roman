/**
 * Async job wrapper for the optimizer (training-mode walk-forward + candidate config generation).
 *
 * Optimizer runs take 12–20+ minutes. Same fire-and-poll pattern as walkForwardJob.ts.
 * Production config is NEVER auto-promoted — this only writes a candidate_configs row.
 */

import { logger } from "../../lib/logger";
import { runOptimizerRun } from "./candidateOptimizer";

type OptimizerResult = {
  candidateConfigId: number;
  thresholdEvaluationId: number;
  walkForward: {
    foldsRun: number;
    foldIds: number[];
    skippedNoEligibleMatches: boolean;
    fallbackRate: number;
    warnings: string[];
  };
};

export type OptimizerJobStatus =
  | { state: "idle" }
  | { state: "running"; startedAt: string; phase: string }
  | { state: "done"; startedAt: string; finishedAt: string; result: OptimizerResult }
  | { state: "error"; startedAt: string; finishedAt: string; error: string };

let currentJob: OptimizerJobStatus = { state: "idle" };

export function getOptimizerJobStatus(): OptimizerJobStatus {
  return currentJob;
}

export function startOptimizerJob(opts: {
  foldCount?: number;
  warmupFraction?: number;
  notes?: string;
}): { started: boolean; reason?: string } {
  if (currentJob.state === "running") {
    return { started: false, reason: "An optimizer run is already in progress." };
  }

  const startedAt = new Date().toISOString();
  currentJob = { state: "running", startedAt, phase: "initializing" };

  // Intentionally not awaited.
  void runJob(startedAt, opts);

  return { started: true };
}

async function runJob(
  startedAt: string,
  opts: { foldCount?: number; warmupFraction?: number; notes?: string },
): Promise<void> {
  try {
    currentJob = { state: "running", startedAt, phase: "walk-forward" };
    const result = await runOptimizerRun(opts);

    currentJob = {
      state: "done",
      startedAt,
      finishedAt: new Date().toISOString(),
      result: {
        candidateConfigId: result.candidateConfigId,
        thresholdEvaluationId: result.thresholdEvaluationId,
        walkForward: {
          foldsRun: result.walkForwardSummary.foldsRun,
          foldIds: result.walkForwardSummary.foldIds,
          skippedNoEligibleMatches: result.walkForwardSummary.skippedNoEligibleMatches,
          fallbackRate: result.walkForwardSummary.fallbackRate,
          warnings: result.walkForwardSummary.warnings,
        },
      },
    };
    logger.info({ candidateConfigId: result.candidateConfigId }, "Optimizer job completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Optimizer job failed");
    currentJob = {
      state: "error",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: message,
    };
  }
}
