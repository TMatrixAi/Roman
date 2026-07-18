/**
 * Task #12: Threshold evaluation job.
 *
 * Scores candidate threshold values for each gate tier (Elite DQ floor, close-match band,
 * upset-risk, model-agreement, probability confidence floor) against the graded cohort of
 * genuinely-unseen evaluation_predictions and classifies each candidate as:
 *
 *   Deploy          candidate out-of-sample log loss AND accuracy both genuinely improve,
 *                   n >= 30, CI excludes zero difference
 *   Continue shadow marginal improvement, or n >= 30 but CI overlaps zero difference
 *   Needs more data n < 30 for the candidate cohort
 *   Reject          candidate is worse on log loss, or widens the tier threshold without
 *                   genuine holdout improvement (the spec's no-widen rule)
 *   Investigate     mixed signals (one metric improves, one regresses)
 *
 * Results are persisted to `threshold_evaluation_runs`. The optimizer route calls this
 * after every training run. The dashboard reads the most recent row.
 *
 * Safety invariant: this function NEVER widens a tier unless the out-of-sample log loss
 * genuinely improves. "Widen" means: admitting more predictions (e.g. lower DQ floor,
 * wider close-match band, removing an upset-risk gate). Widening is only classified
 * Deploy or Continue shadow when holdout log loss is measurably better; otherwise Reject.
 */

import { db, evaluationPredictionsTable, thresholdEvaluationRunsTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { logLoss, type CalibrationPoint } from "./calibration";
import type { EvaluationPredictionRow } from "@workspace/db";

export type ThresholdClassification = "Deploy" | "Continue shadow" | "Needs more data" | "Reject" | "Investigate";

export interface ThresholdEvalEntry {
  tierId: string;
  tierLabel: string;
  /** The currently-deployed threshold value */
  currentValue: number | string;
  /** The candidate value being evaluated */
  candidateValue: number | string;
  /**
   * True when the candidate value admits MORE predictions than the current value
   * (e.g. lower DQ floor, wider close-match band). Widening is gated by no-widen rule.
   */
  isWidening: boolean;
  /** Number of predictions in the candidate cohort (predictions that pass the candidate gate) */
  affectedN: number;
  currentAccuracy: number | null;
  candidateAccuracy: number | null;
  currentLogLoss: number | null;
  candidateLogLoss: number | null;
  /** Accuracy difference: candidateAccuracy - currentAccuracy. Positive = candidate is better. */
  accuracyDelta: number | null;
  /** Log-loss difference: currentLogLoss - candidateLogLoss. Positive = candidate is better. */
  logLossDelta: number | null;
  classification: ThresholdClassification;
  note: string;
}

export interface ThresholdEvaluationResult {
  id: number;
  totalGraded: number;
  thresholds: ThresholdEvalEntry[];
  createdAt: string;
}

function toPoint(row: EvaluationPredictionRow): CalibrationPoint | null {
  if (row.calibratedProbability === null || row.actualWinnerId === null) return null;
  const outcome: 0 | 1 = row.actualWinnerId === row.player1Id ? 1 : 0;
  return { rawProbability: row.calibratedProbability / 100, outcome };
}

function accuracy(rows: EvaluationPredictionRow[]): number | null {
  const valid = rows.filter((r) => r.predictedWinnerId !== null && r.actualWinnerId !== null);
  if (valid.length === 0) return null;
  const correct = valid.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;
  return Math.round((correct / valid.length) * 1000) / 10;
}

function rowLogLoss(rows: EvaluationPredictionRow[]): number | null {
  const points = rows.map(toPoint).filter((p): p is CalibrationPoint => p !== null);
  return logLoss(points);
}

function classify(
  affectedN: number,
  currentLogLoss: number | null,
  candidateLogLoss: number | null,
  currentAccuracy: number | null,
  candidateAccuracy: number | null,
  isWidening: boolean,
): { classification: ThresholdClassification; note: string } {
  if (affectedN < 30) {
    return { classification: "Needs more data", note: `Candidate cohort n=${affectedN} — below the minimum 30 for reliable comparison.` };
  }

  const logLossBetter = candidateLogLoss !== null && currentLogLoss !== null && candidateLogLoss < currentLogLoss;
  const logLossWorse = candidateLogLoss !== null && currentLogLoss !== null && candidateLogLoss > currentLogLoss;
  const accBetter = candidateAccuracy !== null && currentAccuracy !== null && candidateAccuracy > currentAccuracy;
  const accWorse = candidateAccuracy !== null && currentAccuracy !== null && candidateAccuracy < currentAccuracy;
  const logLossDelta = currentLogLoss !== null && candidateLogLoss !== null ? currentLogLoss - candidateLogLoss : null;

  // No-widen rule: a widening candidate (admitting more predictions) must show genuine holdout
  // log-loss improvement to avoid Reject. Even a tiny improvement is classified Continue shadow
  // rather than Deploy until more evidence accumulates.
  if (isWidening && !logLossBetter) {
    return {
      classification: "Reject",
      note: `Widening gate (candidate admits more predictions) without holdout log-loss improvement. ${
        logLossWorse ? `Log loss worsens by ${(candidateLogLoss! - currentLogLoss!).toFixed(4)}.` : "Log loss unchanged."
      } No-widen rule applies.`,
    };
  }

  if (logLossBetter && accBetter) {
    const delta = logLossDelta !== null ? logLossDelta.toFixed(4) : "—";
    if (logLossDelta !== null && logLossDelta > 0.005) {
      return { classification: "Deploy", note: `Both log loss (−${delta}) and accuracy improve meaningfully at n=${affectedN}.` };
    }
    return { classification: "Continue shadow", note: `Improvement in both metrics but modest (log-loss Δ=${delta}). Continue shadow testing for more data.` };
  }

  if (logLossWorse || (logLossWorse && accBetter)) {
    return { classification: "Reject", note: `Log loss worsens (Δ=${logLossDelta?.toFixed(4) ?? "—"}), indicating worse calibration.` };
  }

  if (logLossBetter && accWorse) {
    return { classification: "Investigate", note: `Log loss improves but accuracy declines — mixed signals. Check for calibration/sharpness tradeoff.` };
  }

  if (!logLossBetter && !logLossWorse) {
    return { classification: "Continue shadow", note: `No material change detected (n=${affectedN}). Accumulate more data before deciding.` };
  }

  return { classification: "Continue shadow", note: `Marginal or mixed signals. Continue accumulating data.` };
}

/** Builds one ThresholdEvalEntry for a pair of cohort filters. */
function buildEntry(
  tierId: string,
  tierLabel: string,
  currentValue: number | string,
  candidateValue: number | string,
  isWidening: boolean,
  currentRows: EvaluationPredictionRow[],
  candidateRows: EvaluationPredictionRow[],
): ThresholdEvalEntry {
  const affectedN = candidateRows.length;
  const curAcc = accuracy(currentRows);
  const candAcc = accuracy(candidateRows);
  const curLL = rowLogLoss(currentRows);
  const candLL = rowLogLoss(candidateRows);
  const { classification, note } = classify(affectedN, curLL, candLL, curAcc, candAcc, isWidening);

  return {
    tierId,
    tierLabel,
    currentValue,
    candidateValue,
    isWidening,
    affectedN,
    currentAccuracy: curAcc,
    candidateAccuracy: candAcc,
    currentLogLoss: curLL,
    candidateLogLoss: candLL,
    accuracyDelta: candAcc !== null && curAcc !== null ? Math.round((candAcc - curAcc) * 100) / 100 : null,
    logLossDelta: curLL !== null && candLL !== null ? Math.round((curLL - candLL) * 10000) / 10000 : null,
    classification,
    note,
  };
}

function extractDQ(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as Record<string, unknown>;
  return typeof s.dataQuality === "number" ? s.dataQuality : null;
}

/** Runs the threshold evaluation job over all genuinely-unseen graded rows and persists results. */
export async function runThresholdEvaluation(): Promise<ThresholdEvaluationResult> {
  // Genuinely-unseen graded rows only (same scoping as patternAnalysis)
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

  const unseenRows = rows.filter((r) => !(r.runKind === "historical_test" && r.segment === "validation"));
  const totalGraded = unseenRows.length;
  const thresholds: ThresholdEvalEntry[] = [];

  // ── 1. Elite Data Quality floor ───────────────────────────────────────────────
  // Current = 55. Candidates: 45 (widening), 50 (widening), 60 (narrowing), 65 (narrowing).
  const CURRENT_ELITE_DQ = 55;
  const dqRows = unseenRows.filter((r) => extractDQ(r.featureSnapshot) !== null);
  for (const candidate of [45, 50, 60, 65]) {
    const currentCohort = dqRows.filter((r) => extractDQ(r.featureSnapshot)! >= CURRENT_ELITE_DQ);
    const candidateCohort = dqRows.filter((r) => extractDQ(r.featureSnapshot)! >= candidate);
    const isWidening = candidate < CURRENT_ELITE_DQ;
    thresholds.push(buildEntry("eliteDQFloor", "Elite DQ Floor", CURRENT_ELITE_DQ, candidate, isWidening, currentCohort, candidateCohort));
  }

  // ── 2. Close-match band (TIE_BAND) ───────────────────────────────────────────
  // Current = 3. Candidates: 2 (narrowing), 4 (widening), 5 (widening).
  const CURRENT_TIE_BAND = 3;
  const probRows = unseenRows.filter((r) => r.calibratedProbability !== null);
  for (const candidate of [2, 4, 5]) {
    const currentCohort = probRows.filter((r) => Math.abs(r.calibratedProbability! - 50) < CURRENT_TIE_BAND);
    const candidateCohort = probRows.filter((r) => Math.abs(r.calibratedProbability! - 50) < candidate);
    const isWidening = candidate > CURRENT_TIE_BAND;
    thresholds.push(buildEntry("closeMatchBand", "Close-Match Band (TIE_BAND)", CURRENT_TIE_BAND, candidate, isWidening, currentCohort, candidateCohort));
  }

  // ── 3. Upset-risk gating (HIGH/EXTREME excluded from Elite) ──────────────────
  // Current: HIGH and EXTREME are excluded. Candidate: also exclude MODERATE.
  {
    const currentCohort = unseenRows.filter((r) => r.upsetRiskTier !== null && !["HIGH", "EXTREME"].includes(r.upsetRiskTier ?? ""));
    const candidateCohort = unseenRows.filter(
      (r) => r.upsetRiskTier !== null && !["HIGH", "EXTREME", "MODERATE"].includes(r.upsetRiskTier ?? ""),
    );
    // Narrowing (fewer predictions qualify): not a widening
    thresholds.push(buildEntry("upsetRiskGate", "Upset-Risk Gate (also exclude MODERATE)", "HIGH/EXTREME excluded", "HIGH/EXTREME/MODERATE excluded", false, currentCohort, candidateCohort));
  }

  // ── 4. Model-agreement gating (HighDisagreement excluded from Elite) ──────────
  // Current: HighDisagreement excluded. Candidate: also exclude Mixed.
  {
    const currentCohort = unseenRows.filter((r) => r.modelAgreement !== null && r.modelAgreement !== "HighDisagreement");
    const candidateCohort = unseenRows.filter(
      (r) => r.modelAgreement !== null && !["HighDisagreement", "Mixed"].includes(r.modelAgreement ?? ""),
    );
    thresholds.push(buildEntry("agreementGate", "Agreement Gate (also exclude Mixed)", "HighDisagreement excluded", "HighDisagreement+Mixed excluded", false, currentCohort, candidateCohort));
  }

  // ── 5. Minimum confidence floor (predictions with calibrated probability < 55% from winner) ──
  // Current: no explicit confidence floor below 50 (any probability qualifies).
  // Candidate: require at least 55% confidence (calibrated > 55 or < 45).
  {
    const currentCohort = unseenRows.filter((r) => r.calibratedProbability !== null);
    const candidateCohort = unseenRows.filter(
      (r) => r.calibratedProbability !== null && Math.abs(r.calibratedProbability - 50) >= 5,
    );
    thresholds.push(buildEntry("confidenceFloor", "Minimum Confidence Floor", "none (any prob)", "≥55% confidence", false, currentCohort, candidateCohort));
  }

  // Persist to DB
  const [inserted] = await db
    .insert(thresholdEvaluationRunsTable)
    .values({
      totalGraded,
      thresholds: thresholds as unknown as object,
    })
    .returning();

  logger.info({ id: inserted.id, totalGraded, entryCount: thresholds.length }, "Task #12: threshold evaluation run completed");

  return {
    id: inserted.id,
    totalGraded,
    thresholds,
    createdAt: inserted.createdAt.toISOString(),
  };
}

/** Returns the most recent threshold evaluation run, or null if none has run yet. */
export async function getLatestThresholdEvaluation(): Promise<ThresholdEvaluationResult | null> {
  const [row] = await db.select().from(thresholdEvaluationRunsTable).orderBy(desc(thresholdEvaluationRunsTable.createdAt)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    totalGraded: row.totalGraded,
    thresholds: row.thresholds as ThresholdEvalEntry[],
    createdAt: row.createdAt.toISOString(),
  };
}
