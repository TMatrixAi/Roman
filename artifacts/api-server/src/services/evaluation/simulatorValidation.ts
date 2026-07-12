import { db, evaluationPredictionsTable, predictionsTable, simulatorValidationTable } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { logLoss, brierScore, type CalibrationPoint } from "./calibration";
import { deriveServicePointEstimate, runMatchSimulation } from "../predictionEngine/simulator";
import type { EngineBreakdown } from "../predictionEngine";
import type { LiveFeatureSnapshot } from "./types";
import type { SimulatorAdoptionInput } from "../predictionEngine/types";

/**
 * The simulator needs at least this many real, graded, out-of-sample match outcomes before its
 * measured performance is trusted at all -- fitting a comparison on a handful of matches would
 * just be measuring noise. Mirrors the same rough floor used for Phase 6 specialist segments
 * (`MIN_VALIDATION_SAMPLES_FOR_SEGMENT`).
 */
export const MIN_SAMPLE_SIZE_FOR_SIMULATOR = 30;

interface GradedPoint {
  engine: EngineBreakdown;
  matchFormat: "BestOf3" | "BestOf5";
  player1Won: boolean;
  ensembleCalibratedProbability: number; // 0-100, player1
}

/**
 * Gathers every real graded outcome the simulator's inputs can actually be reconstructed from.
 *
 * Only two sources qualify:
 *  - `evaluation_predictions` rows with runKind in (paper_trade, live), status='graded',
 *    includedInAccuracy, and a stored LiveFeatureSnapshot (full EngineBreakdown) -- these are
 *    Phase 4's real, cutoff-locked, out-of-sample ledger.
 *  - Resolved rows in `predictions` (the ad-hoc live endpoint) -- these are real predictions made
 *    before the outcome was known (actualWinnerId starts null and is only set after the fact via
 *    the outcome-recording endpoint), but they don't go through the formal pre-registration/cutoff
 *    ledger, so they're labeled a supplementary source rather than conflated with Phase 4 rigor.
 *
 * `historical_test` rows are deliberately excluded even though they now carry a full
 * `LiveFeatureSnapshot` too (historical backtests run the exact same `runPredictionEngine`
 * ensemble, see `historicalScoring.ts`): they are re-scored/re-fit on every walk-forward run,
 * so their `calibratedProbability` reflects whatever the most recent fold's calibration mapping
 * happened to be, not the single durable, monotonically-accumulating ledger the paper-trading/
 * live cycle produces. Mixing the two would make sample composition depend on when this ran
 * relative to the last walk-forward re-run. Extending simulator validation to also draw on
 * historical backtests is tracked as a separate follow-up, not solved here.
 */
async function gatherGradedPoints(): Promise<{ points: GradedPoint[]; ledgerCount: number; adHocCount: number }> {
  const ledgerRows = await db
    .select()
    .from(evaluationPredictionsTable)
    .where(
      and(
        or(eq(evaluationPredictionsTable.runKind, "paper_trade"), eq(evaluationPredictionsTable.runKind, "live")),
        eq(evaluationPredictionsTable.status, "graded"),
        eq(evaluationPredictionsTable.includedInAccuracy, true),
      ),
    );

  const points: GradedPoint[] = [];
  let ledgerCount = 0;
  for (const row of ledgerRows) {
    const snapshot = row.featureSnapshot as LiveFeatureSnapshot | null;
    if (!snapshot?.engine || row.actualWinnerId === null || row.calibratedProbability === null || !row.matchFormat) continue;
    points.push({
      engine: snapshot.engine,
      matchFormat: row.matchFormat as "BestOf3" | "BestOf5",
      player1Won: row.actualWinnerId === row.player1Id,
      ensembleCalibratedProbability: row.calibratedProbability,
    });
    ledgerCount++;
  }

  const adHocRows = await db.select().from(predictionsTable);
  let adHocCount = 0;
  for (const row of adHocRows) {
    if (row.actualWinnerId === null || !row.engine) continue;
    const engine = row.engine as EngineBreakdown;
    if (!engine.surfaceElo || !engine.serveReturn) continue;
    points.push({
      engine,
      matchFormat: row.matchFormat as "BestOf3" | "BestOf5",
      player1Won: row.actualWinnerId === row.player1Id,
      ensembleCalibratedProbability: row.calibratedProbability,
    });
    adHocCount++;
  }

  return { points, ledgerCount, adHocCount };
}

function accuracyOf(predictions: Array<{ prob: number; outcome: 0 | 1 }>): number | null {
  if (predictions.length === 0) return null;
  const correct = predictions.filter((p) => (p.prob >= 0.5 ? 1 : 0) === p.outcome).length;
  return Math.round((correct / predictions.length) * 1000) / 10;
}

/**
 * Derives the simulator's blend weight (0-1) purely from measured performance -- never
 * hand-picked. Mirrors `specialistWeights.ts`'s `computeSpecialistWeight`: base weight grows with
 * sample size (capped at 0.5 -- the simulator is a single supplementary signal, not a second
 * full model, so it never earns as much say as the specialist blend does), then shifts up/down by
 * how much its logLoss beats or trails the existing ensemble's on the same points.
 */
function computeSimulatorWeight(sampleSize: number, simulatorLogLoss: number | null, ensembleLogLoss: number | null): number {
  const baseWeight = Math.min(0.5, sampleSize / (sampleSize + 80));
  if (simulatorLogLoss === null || ensembleLogLoss === null) return Math.round(Math.max(0.05, Math.min(0.5, baseWeight)) * 1000) / 1000;

  const improvement = ensembleLogLoss - simulatorLogLoss; // positive => simulator calibrates better
  const perfAdjustment = Math.max(-0.15, Math.min(0.15, (improvement / 0.05) * 0.15));
  return Math.round(Math.max(0.05, Math.min(0.5, baseWeight + perfAdjustment)) * 1000) / 1000;
}

export interface SimulatorValidationSummary {
  sampleSize: number;
  minSampleSize: number;
  ledgerSampleSize: number;
  adHocSampleSize: number;
  simulatorAccuracy: number | null;
  simulatorLogLoss: number | null;
  simulatorBrier: number | null;
  ensembleAccuracy: number | null;
  ensembleLogLoss: number | null;
  ensembleBrier: number | null;
  adopted: boolean;
  weight: number;
  note: string;
}

/**
 * Recomputes the simulator's validation status from every real graded outcome currently
 * available and persists the single result row. Honest either way: below
 * `MIN_SAMPLE_SIZE_FOR_SIMULATOR`, or when the simulator doesn't measurably beat the existing
 * ensemble's logLoss on the same points, `adopted` is false and `note` says exactly why -- the
 * simulator is never silently blended in just because it exists.
 */
export async function validateAndStoreSimulator(): Promise<SimulatorValidationSummary> {
  const { points, ledgerCount, adHocCount } = await gatherGradedPoints();

  if (points.length < MIN_SAMPLE_SIZE_FOR_SIMULATOR) {
    const note = `Only ${points.length} real graded outcome(s) with a full engine snapshot are available (${ledgerCount} from the Phase 4 paper-trading/live ledger, ${adHocCount} from resolved ad-hoc predictions) -- needs at least ${MIN_SAMPLE_SIZE_FOR_SIMULATOR} before the simulator's performance can be measured honestly. Not adopted; shown for transparency only.`;
    const summary: SimulatorValidationSummary = {
      sampleSize: points.length,
      minSampleSize: MIN_SAMPLE_SIZE_FOR_SIMULATOR,
      ledgerSampleSize: ledgerCount,
      adHocSampleSize: adHocCount,
      simulatorAccuracy: null,
      simulatorLogLoss: null,
      simulatorBrier: null,
      ensembleAccuracy: null,
      ensembleLogLoss: null,
      ensembleBrier: null,
      adopted: false,
      weight: 0,
      note,
    };
    await persist(summary);
    return summary;
  }

  const simulatorPredictions: Array<{ prob: number; outcome: 0 | 1 }> = [];
  const ensemblePredictions: Array<{ prob: number; outcome: 0 | 1 }> = [];

  for (const point of points) {
    const estimate = deriveServicePointEstimate(point.engine.surfaceElo, point.engine.serveReturn);
    const simulation = runMatchSimulation(estimate, point.matchFormat);
    const outcome: 0 | 1 = point.player1Won ? 1 : 0;
    simulatorPredictions.push({ prob: simulation.player1WinProbability / 100, outcome });
    ensemblePredictions.push({ prob: point.ensembleCalibratedProbability / 100, outcome });
  }

  const simPoints: CalibrationPoint[] = simulatorPredictions.map((p) => ({ rawProbability: p.prob, outcome: p.outcome }));
  const ensPoints: CalibrationPoint[] = ensemblePredictions.map((p) => ({ rawProbability: p.prob, outcome: p.outcome }));

  const simulatorAccuracy = accuracyOf(simulatorPredictions);
  const ensembleAccuracy = accuracyOf(ensemblePredictions);
  const simulatorLogLoss = logLoss(simPoints);
  const ensembleLogLoss = logLoss(ensPoints);
  const simulatorBrier = brierScore(simPoints);
  const ensembleBrier = brierScore(ensPoints);

  const beatsEnsemble = simulatorLogLoss !== null && ensembleLogLoss !== null && simulatorLogLoss < ensembleLogLoss;
  const weight = beatsEnsemble ? computeSimulatorWeight(points.length, simulatorLogLoss, ensembleLogLoss) : 0;
  const adopted = beatsEnsemble && weight > 0;

  const note = adopted
    ? `Validated on ${points.length} real graded outcome(s) (${ledgerCount} ledger, ${adHocCount} ad-hoc): simulator logLoss ${simulatorLogLoss!.toFixed(3)} beats the ensemble's ${ensembleLogLoss!.toFixed(3)} on the same points -- adopted into the live blend at weight ${Math.round(weight * 100)}%.`
    : `Validated on ${points.length} real graded outcome(s) (${ledgerCount} ledger, ${adHocCount} ad-hoc): simulator logLoss ${simulatorLogLoss?.toFixed(3) ?? "n/a"} does not beat the ensemble's ${ensembleLogLoss?.toFixed(3) ?? "n/a"} on the same points -- not adopted; shown for transparency only.`;

  const summary: SimulatorValidationSummary = {
    sampleSize: points.length,
    minSampleSize: MIN_SAMPLE_SIZE_FOR_SIMULATOR,
    ledgerSampleSize: ledgerCount,
    adHocSampleSize: adHocCount,
    simulatorAccuracy,
    simulatorLogLoss,
    simulatorBrier,
    ensembleAccuracy,
    ensembleLogLoss,
    ensembleBrier,
    adopted,
    weight,
    note,
  };

  await persist(summary);
  logger.info({ sampleSize: points.length, adopted, weight }, "Recomputed Phase 7 simulator validation status");
  return summary;
}

async function persist(summary: SimulatorValidationSummary): Promise<void> {
  // Single-row table -- wipe and reinsert so there's never more than one, always-current status.
  await db.delete(simulatorValidationTable);
  await db.insert(simulatorValidationTable).values({
    sampleSize: summary.sampleSize,
    minSampleSize: summary.minSampleSize,
    simulatorAccuracy: summary.simulatorAccuracy,
    simulatorLogLoss: summary.simulatorLogLoss,
    simulatorBrier: summary.simulatorBrier,
    ensembleAccuracy: summary.ensembleAccuracy,
    ensembleLogLoss: summary.ensembleLogLoss,
    ensembleBrier: summary.ensembleBrier,
    adopted: summary.adopted,
    weight: summary.weight,
    note: summary.note,
  });
}

/**
 * Resolves the caller-facing `SimulatorAdoptionInput` the prediction engine expects (mirrors
 * `resolveSegmentSpecialistInput`'s pattern). Returns "not adopted yet" with an honest note when
 * no validation run has ever completed, exactly like a segment that hasn't cleared its threshold.
 */
export async function resolveSimulatorAdoption(): Promise<SimulatorAdoptionInput> {
  const [row] = await db.select().from(simulatorValidationTable).limit(1);
  if (!row) {
    return {
      adopted: false,
      sampleSize: 0,
      minSampleSize: MIN_SAMPLE_SIZE_FOR_SIMULATOR,
      note: `The Monte Carlo simulator has not been validated yet (no validation run has completed) -- shown for transparency only, not yet voted into the final probability. Needs at least ${MIN_SAMPLE_SIZE_FOR_SIMULATOR} real graded outcomes with a full engine snapshot.`,
    };
  }

  return {
    adopted: row.adopted,
    weight: row.adopted ? row.weight : undefined,
    sampleSize: row.sampleSize,
    minSampleSize: row.minSampleSize,
    note: row.note,
  };
}
