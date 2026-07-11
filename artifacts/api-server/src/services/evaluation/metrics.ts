import type { EvaluationPredictionRow } from "@workspace/db";
import { brierScore, logLoss, type CalibrationPoint } from "./calibration";

export interface SegmentMetrics {
  n: number;
  accuracy: number | null;
  logLoss: number | null;
  brier: number | null;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  retiredCount: number;
  retiredAccuracy: number | null;
  voidCount: number;
  missedCount: number;
}

function toPoint(row: EvaluationPredictionRow): CalibrationPoint | null {
  if (row.calibratedProbability === null || row.actualWinnerId === null) return null;
  const outcome: 0 | 1 = row.actualWinnerId === row.player1Id ? 1 : 0;
  // calibratedProbability is stored 0-100 (player1 win %); logLoss/brier math expects 0-1.
  return { rawProbability: row.calibratedProbability / 100, outcome };
}

/**
 * Computes honestly-scoped accuracy/logLoss/Brier for one segment of evaluation predictions.
 * Only `includedInAccuracy` rows feed the headline numbers; retirements, voids, and misses are
 * always reported as separate counts so a dashboard reader can see exactly what was excluded and
 * why, rather than a single number that quietly absorbs edge cases.
 */
export function computeSegmentMetrics(rows: EvaluationPredictionRow[]): SegmentMetrics {
  const graded = rows.filter((r) => r.status === "graded" || r.status === "void");
  const included = graded.filter((r) => r.includedInAccuracy);
  const points = included.map(toPoint).filter((p): p is CalibrationPoint => p !== null);

  const correct = included.filter((r) => r.actualWinnerId === r.predictedWinnerId).length;
  const retired = graded.filter((r) => r.resultType === "retired");
  const retiredCorrect = retired.filter((r) => r.actualWinnerId === r.predictedWinnerId).length;

  const dates = rows.map((r) => r.scheduledStartAt.getTime());
  const dateRangeStart = dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : null;
  const dateRangeEnd = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;

  return {
    n: included.length,
    accuracy: included.length > 0 ? Math.round((correct / included.length) * 1000) / 10 : null,
    logLoss: logLoss(points),
    brier: brierScore(points),
    dateRangeStart,
    dateRangeEnd,
    retiredCount: retired.length,
    retiredAccuracy: retired.length > 0 ? Math.round((retiredCorrect / retired.length) * 1000) / 10 : null,
    voidCount: rows.filter((r) => r.status === "void").length,
    missedCount: rows.filter((r) => r.status === "missed").length,
  };
}

export interface CalibrationBucket {
  label: string;
  min: number;
  max: number;
  n: number;
  avgPredicted: number | null;
  observedAccuracy: number | null;
}

const BUCKET_EDGES = [50, 55, 60, 65, 70, 75, 80, 100];

/** Buckets predictions by "distance from a coin flip toward the predicted winner", 50-54.9%, ..., 80%+. */
export function computeCalibrationBuckets(rows: EvaluationPredictionRow[]): CalibrationBucket[] {
  const included = rows.filter((r) => (r.status === "graded" || r.status === "void") && r.includedInAccuracy && r.calibratedProbability !== null);

  return BUCKET_EDGES.slice(0, -1).map((min, i) => {
    const max = BUCKET_EDGES[i + 1];
    const inBucket = included.filter((r) => {
      const confidence = Math.max(r.calibratedProbability!, 100 - r.calibratedProbability!);
      return confidence >= min && (max === 100 ? confidence <= 100 : confidence < max);
    });
    const correct = inBucket.filter((r) => r.actualWinnerId === r.predictedWinnerId).length;
    const avgPredicted =
      inBucket.length > 0
        ? inBucket.reduce((sum, r) => sum + Math.max(r.calibratedProbability!, 100 - r.calibratedProbability!), 0) / inBucket.length
        : null;

    return {
      label: max === 100 ? `${min}%+` : `${min}-${max - 0.1}%`,
      min,
      max,
      n: inBucket.length,
      avgPredicted: avgPredicted !== null ? Math.round(avgPredicted * 10) / 10 : null,
      observedAccuracy: inBucket.length > 0 ? Math.round((correct / inBucket.length) * 1000) / 10 : null,
    };
  });
}

export interface StreakSummary {
  currentStreakType: "win" | "loss" | null;
  currentStreakLength: number;
  longestWinStreak: number;
  longestLossStreak: number;
}

/** Chronological (by scheduledStartAt) win/loss streaks across `includedInAccuracy` rows only. */
export function computeStreaks(rows: EvaluationPredictionRow[]): StreakSummary {
  const included = rows
    .filter((r) => (r.status === "graded" || r.status === "void") && r.includedInAccuracy)
    .sort((a, b) => a.scheduledStartAt.getTime() - b.scheduledStartAt.getTime());

  let longestWin = 0;
  let longestLoss = 0;
  let runType: "win" | "loss" | null = null;
  let runLength = 0;

  for (const row of included) {
    const won = row.actualWinnerId === row.predictedWinnerId;
    const type = won ? "win" : "loss";
    if (type === runType) {
      runLength += 1;
    } else {
      runType = type;
      runLength = 1;
    }
    if (type === "win") longestWin = Math.max(longestWin, runLength);
    else longestLoss = Math.max(longestLoss, runLength);
  }

  return {
    currentStreakType: runType,
    currentStreakLength: runLength,
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
  };
}
