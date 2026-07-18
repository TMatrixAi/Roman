/**
 * Task #12: Correct-vs-incorrect pattern analysis.
 *
 * Queries all graded, accuracy-included evaluation_predictions (historical_test test-segment +
 * paper_trade/live -- never validation-segment, shadow, or pending/void rows), splits them by
 * correct/incorrect, and computes per-dimension accuracy/logLoss/Brier/ECE/CI breakdowns.
 *
 * Results are persisted to `pattern_analysis_runs` and returned. The walk-forward runner calls
 * this automatically after every run (both evaluation-only and training modes). The dashboard
 * GET endpoint always reads the most recent row rather than recomputing on each request.
 *
 * Evidence strength labels:
 *   Strong      n >= 100 and 95% CI width < 0.12
 *   Moderate    n >= 30
 *   Weak        n >= 10
 *   Insufficient n < 10
 */

import { db, evaluationPredictionsTable, patternAnalysisRunsTable } from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { logLoss, brierScore, isKnownBadCascadeRow, type CalibrationPoint } from "./calibration";
import { computeECE } from "./metrics";
import type { EvaluationPredictionRow } from "@workspace/db";

export interface PatternSegment {
  /** Dimension being sliced, e.g. "surface", "upsetRiskTier" */
  dimension: string;
  /** Value within that dimension, e.g. "Hard", "HIGH" */
  value: string;
  /** Total rows in this segment */
  n: number;
  /** Correctly predicted rows */
  correct: number;
  /** Accuracy 0-100 */
  accuracy: number | null;
  logLoss: number | null;
  brier: number | null;
  /** Expected Calibration Error on calibrated probabilities */
  ece: number | null;
  /** 95% Wilson confidence interval lower bound for accuracy */
  ciLow: number | null;
  /** 95% Wilson confidence interval upper bound for accuracy */
  ciHigh: number | null;
  /** Strong / Moderate / Weak / Insufficient */
  evidenceStrength: "Strong" | "Moderate" | "Weak" | "Insufficient";
}

export interface PatternAnalysisResult {
  id: number;
  totalAnalyzed: number;
  segments: PatternSegment[];
  runKindsIncluded: string[];
  createdAt: string;
}

function toPoint(row: EvaluationPredictionRow): CalibrationPoint | null {
  if (row.calibratedProbability === null || row.actualWinnerId === null) return null;
  const outcome: 0 | 1 = row.actualWinnerId === row.player1Id ? 1 : 0;
  return { rawProbability: row.calibratedProbability / 100, outcome };
}

/** Wilson score 95% confidence interval for a proportion. Returns [low, high] as 0-100 values. */
function wilsonCI(correct: number, n: number): [number, number] {
  if (n === 0) return [0, 100];
  const z = 1.96;
  const p = correct / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, (center - half) * 100), Math.min(100, (center + half) * 100)];
}

function evidenceLabel(n: number, ciLow: number | null, ciHigh: number | null): PatternSegment["evidenceStrength"] {
  if (n < 10) return "Insufficient";
  if (n < 30) return "Weak";
  if (n < 100) return "Moderate";
  const ciWidth = ciLow !== null && ciHigh !== null ? ciHigh - ciLow : 100;
  return ciWidth < 12 ? "Strong" : "Moderate";
}

function segmentFor(rows: EvaluationPredictionRow[], dimension: string, value: string): PatternSegment {
  const included = rows.filter((r) => r.includedInAccuracy && r.status === "graded" && r.predictedWinnerId !== null && r.actualWinnerId !== null);
  const n = included.length;
  const correct = included.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;
  const accuracy = n > 0 ? Math.round((correct / n) * 1000) / 10 : null;

  const points = included.map(toPoint).filter((p): p is CalibrationPoint => p !== null);
  const ll = logLoss(points);
  const bs = brierScore(points);
  const ece = computeECE(points);

  const [ciLow, ciHigh] = n > 0 ? wilsonCI(correct, n) : [null, null];
  const ciLowRounded = ciLow !== null ? Math.round(ciLow * 10) / 10 : null;
  const ciHighRounded = ciHigh !== null ? Math.round(ciHigh * 10) / 10 : null;

  return {
    dimension,
    value,
    n,
    correct,
    accuracy,
    logLoss: ll,
    brier: bs,
    ece,
    ciLow: ciLowRounded,
    ciHigh: ciHighRounded,
    evidenceStrength: evidenceLabel(n, ciLowRounded, ciHighRounded),
  };
}

/**
 * Extracts the `dataQuality` value from a featureSnapshot (LiveFeatureSnapshot shape).
 * Returns null when the snapshot is missing or is a legacy HistoricalFeatureSnapshot.
 */
function extractDQ(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as Record<string, unknown>;
  if (typeof s.dataQuality === "number") return s.dataQuality;
  // Legacy HistoricalFeatureSnapshot doesn't have dataQuality.
  return null;
}

function dqTierLabel(dq: number): string {
  if (dq >= 80) return "High (≥80)";
  if (dq >= 65) return "Good (65-79)";
  if (dq >= 55) return "Acceptable (55-64)";
  return "Low (<55)";
}

function probabilityBandLabel(calibrated: number): string {
  const confidence = Math.max(calibrated, 100 - calibrated);
  if (confidence >= 80) return "80%+";
  if (confidence >= 75) return "75-80%";
  if (confidence >= 70) return "70-75%";
  if (confidence >= 65) return "65-70%";
  if (confidence >= 60) return "60-65%";
  if (confidence >= 55) return "55-60%";
  return "50-55%";
}

/** Runs the full pattern analysis over all genuinely-unseen graded rows and persists results. */
export async function runPatternAnalysis(): Promise<PatternAnalysisResult> {
  // Only analyze genuinely-unseen rows: historical_test test-segment + paper_trade/live.
  // Exclude: validation-segment (used to fit calibration), shadow (simulated), pending/void.
  const rows = await db
    .select()
    .from(evaluationPredictionsTable)
    .where(
      and(
        eq(evaluationPredictionsTable.status, "graded"),
        eq(evaluationPredictionsTable.includedInAccuracy, true),
        ne(evaluationPredictionsTable.runKind, "paper_trade_shadow"),
      ),
    );

  // Exclude historical_test validation-segment (used for calibration fitting)
  const postValidationFilter = rows.filter((r) => !(r.runKind === "historical_test" && r.segment === "validation"));

  // Exclude known-bad pre-cascade rows: predictions locked before 2026-07-15 with
  // tieBreakerApplied=true were scored by the old directional cascade (removed Task #5, 2026-07-15)
  // which achieved only ~30.8% accuracy on close matchups vs a 76.9% baseline. Including them
  // skews pattern analysis metrics toward incorrectly-scored close-call predictions.
  const cascadeBadRows = postValidationFilter.filter((r) => isKnownBadCascadeRow(r.lockedAt, r.featureSnapshot));
  if (cascadeBadRows.length > 0) {
    logger.warn(
      { excludedCascadeRows: cascadeBadRows.length, remaining: postValidationFilter.length - cascadeBadRows.length },
      "Excluded known-bad pre-cascade rows from pattern analysis corpus",
    );
  }
  const unseenRows = postValidationFilter.filter((r) => !isKnownBadCascadeRow(r.lockedAt, r.featureSnapshot));

  const runKindsIncluded = [...new Set(unseenRows.map((r) => r.runKind))];
  const totalAnalyzed = unseenRows.length;

  const segments: PatternSegment[] = [];

  // ── Surface ──────────────────────────────────────────────────────────────────
  const surfaces = [...new Set(unseenRows.map((r) => r.surface).filter(Boolean))] as string[];
  for (const surface of surfaces) {
    segments.push(segmentFor(unseenRows.filter((r) => r.surface === surface), "surface", surface));
  }

  // ── Tour level (ATP/WTA via tournamentLevel) ──────────────────────────────────
  const tourLevels = [...new Set(unseenRows.map((r) => r.tournamentLevel).filter(Boolean))] as string[];
  for (const level of tourLevels) {
    segments.push(segmentFor(unseenRows.filter((r) => r.tournamentLevel === level), "tournamentLevel", level));
  }

  // ── Probability band (confidence distance from 50) ────────────────────────────
  const probBandRows = unseenRows.filter((r) => r.calibratedProbability !== null);
  const probBandValues = ["50-55%", "55-60%", "60-65%", "65-70%", "70-75%", "75-80%", "80%+"];
  for (const band of probBandValues) {
    const inBand = probBandRows.filter((r) => probabilityBandLabel(r.calibratedProbability!) === band);
    segments.push(segmentFor(inBand, "probabilityBand", band));
  }

  // ── Upset-risk tier ──────────────────────────────────────────────────────────
  const upsetTiers = ["LOW", "MODERATE", "HIGH", "EXTREME"];
  for (const tier of upsetTiers) {
    segments.push(segmentFor(unseenRows.filter((r) => r.upsetRiskTier === tier), "upsetRiskTier", tier));
  }

  // ── Model agreement tier ─────────────────────────────────────────────────────
  const agreementTiers = ["Strong", "Moderate", "Mixed", "HighDisagreement"];
  for (const tier of agreementTiers) {
    segments.push(segmentFor(unseenRows.filter((r) => r.modelAgreement === tier), "modelAgreement", tier));
  }

  // ── Close-match flag (calibrated probability within TIE_BAND of 50) ──────────
  const TIE_BAND = 3;
  const closeRows = unseenRows.filter((r) => r.calibratedProbability !== null && Math.abs(r.calibratedProbability - 50) < TIE_BAND);
  const clearRows = unseenRows.filter((r) => r.calibratedProbability !== null && Math.abs(r.calibratedProbability - 50) >= TIE_BAND);
  segments.push(segmentFor(closeRows, "closeMatch", "close (<3% from 50)"));
  segments.push(segmentFor(clearRows, "closeMatch", "clear (≥3% from 50)"));

  // ── Data quality tier (from featureSnapshot) ─────────────────────────────────
  const dqTierLabels = ["High (≥80)", "Good (65-79)", "Acceptable (55-64)", "Low (<55)"];
  for (const label of dqTierLabels) {
    const inTier = unseenRows.filter((r) => {
      const dq = extractDQ(r.featureSnapshot);
      if (dq === null) return false;
      return dqTierLabel(dq) === label;
    });
    segments.push(segmentFor(inTier, "dataQualityTier", label));
  }

  // ── Run kind (historical vs paper trade) ─────────────────────────────────────
  for (const kind of ["historical_test", "paper_trade", "live"]) {
    const kindRows = unseenRows.filter((r) => r.runKind === kind);
    if (kindRows.length > 0) {
      segments.push(segmentFor(kindRows, "runKind", kind));
    }
  }

  // Persist to DB
  const [inserted] = await db
    .insert(patternAnalysisRunsTable)
    .values({
      totalAnalyzed,
      segments: segments as unknown as object,
      runKindsIncluded,
    })
    .returning();

  logger.info(
    { id: inserted.id, totalAnalyzed, segmentCount: segments.length, runKinds: runKindsIncluded },
    "Task #12: pattern analysis run completed",
  );

  return {
    id: inserted.id,
    totalAnalyzed,
    segments,
    runKindsIncluded,
    createdAt: inserted.createdAt.toISOString(),
  };
}

/** Returns the most recent pattern analysis run, or null if none has run yet. */
export async function getLatestPatternAnalysis(): Promise<PatternAnalysisResult | null> {
  const [row] = await db.select().from(patternAnalysisRunsTable).orderBy(desc(patternAnalysisRunsTable.createdAt)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    totalAnalyzed: row.totalAnalyzed,
    segments: row.segments as PatternSegment[],
    runKindsIncluded: row.runKindsIncluded,
    createdAt: row.createdAt.toISOString(),
  };
}
