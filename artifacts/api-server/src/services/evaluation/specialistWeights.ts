import { db, evaluationPredictionsTable, historicalMatchesTable, specialistModelsTable, type SpecialistModelRow } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { fitBestCalibration, splitForCalibrationHoldout, applyCalibration, logLoss, brierScore, type CalibrationPoint } from "./calibration";
import { listCandidateSegments, resolveSegment, type SegmentDefinition } from "../predictionEngine/segments";
import type { CalibrationKnot } from "./types";
import type { SegmentSpecialistInput } from "../predictionEngine/types";
import type { Surface } from "../tennisData/types";

/**
 * A segment needs at least this many real historical matches (Phase 3 coverage, regardless of
 * whether they were ever scored) before it's even considered for a dedicated specialist. Below
 * this, a segment-specific calibration curve would be fit on noise -- the general model's much
 * larger pooled sample is the more honest estimate. This mirrors `runWalkForwardEvaluation`'s own
 * floor (it refuses to run at all under 20 matches total) scaled up per segment, since a segment
 * is inherently a slice of that same corpus.
 */
export const MIN_HISTORICAL_MATCHES_FOR_SEGMENT = 150;

/**
 * A segment also needs at least this many validation-window predictions with a known outcome
 * before its own isotonic curve is trusted -- fitting PAVA on a handful of points produces a
 * curve that just memorizes those points rather than generalizing. 30 is the same rough floor
 * used elsewhere in this codebase for "low-confidence but non-trivial" sample sizes (e.g.
 * `computeSegmentMetrics`'s callers already treat sub-30 samples as too thin to headline).
 */
export const MIN_VALIDATION_SAMPLES_FOR_SEGMENT = 30;

export interface SpecialistSegmentSummary extends SpecialistModelRow {}

/**
 * Recomputes every candidate tour/surface specialist segment from the walk-forward runner's own
 * validation-segment output and persists the result. Must be called only after
 * `runWalkForwardEvaluation` has finished writing its historical_test rows for this run -- this
 * function does not run any evaluation itself, it only measures and weights what Phase 4 already
 * produced.
 *
 * For each candidate segment:
 *  - Counts real historical matches in that tour+surface (the Phase 3 coverage check).
 *  - Below `MIN_HISTORICAL_MATCHES_FOR_SEGMENT` or `MIN_VALIDATION_SAMPLES_FOR_SEGMENT`: persisted
 *    with `meetsThreshold=false` and `weight=0` -- the live engine falls back to the general model
 *    entirely for this segment, with a visible disclaimer, rather than fitting an under-trained
 *    curve silently.
 *  - Otherwise: fits a segment-only calibration (isotonic or Platt, holdout-validated exactly like
 *    the general model -- see `fitBestCalibration`) from that segment's validation points, and
 *    compares its logLoss against the pooled/general mapping applied to the SAME held-out slice
 *    (when the segment has enough points to hold one back) -- the fair, apples-to-apples,
 *    non-overfit baseline. The specialist's blend weight is derived only from that measured
 *    improvement (or lack of it), never hand-picked.
 */
export async function computeAndStoreSpecialistSegments(generalMapping: CalibrationKnot[]): Promise<SpecialistSegmentSummary[]> {
  const segments = listCandidateSegments();
  const results: SpecialistSegmentSummary[] = [];

  for (const segment of segments) {
    const summary = await computeOneSegment(segment, generalMapping);
    const [upserted] = await db
      .insert(specialistModelsTable)
      .values(summary)
      .onConflictDoUpdate({
        target: specialistModelsTable.segmentKey,
        set: { ...summary, computedAt: new Date() },
      })
      .returning();
    results.push(upserted);
  }

  logger.info(
    { segments: results.map((r) => ({ key: r.segmentKey, meetsThreshold: r.meetsThreshold, weight: r.weight, n: r.validationSampleSize })) },
    "Recomputed Phase 6 specialist segment weights",
  );

  return results;
}

async function computeOneSegment(segment: SegmentDefinition, generalMapping: CalibrationKnot[]) {
  const [{ count: historicalMatchCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(historicalMatchesTable)
    .where(and(eq(historicalMatchesTable.tour, segment.tour), eq(historicalMatchesTable.surface, segment.surface)));

  const base = {
    segmentKey: segment.segmentKey,
    tour: segment.tour,
    surface: segment.surface,
    label: segment.label,
    historicalMatchCount,
  };

  if (historicalMatchCount < MIN_HISTORICAL_MATCHES_FOR_SEGMENT) {
    return {
      ...base,
      meetsThreshold: false,
      validationSampleSize: 0,
      accuracy: null,
      logLoss: null,
      brier: null,
      generalAccuracy: null,
      generalLogLoss: null,
      generalBrier: null,
      calibrationMapping: [],
      weight: 0,
    };
  }

  // Validation-segment rows for this tour+surface: historical_test rows only (paper_trade rows
  // aren't tied to a historicalMatchId and haven't yet accumulated their own leak-proof corpus),
  // joined back to historicalMatches for the authoritative per-match tour.
  const rows = await db
    .select({
      rawProbability: evaluationPredictionsTable.rawProbability,
      player1Id: evaluationPredictionsTable.player1Id,
      actualWinnerId: evaluationPredictionsTable.actualWinnerId,
      includedInAccuracy: evaluationPredictionsTable.includedInAccuracy,
    })
    .from(evaluationPredictionsTable)
    .innerJoin(historicalMatchesTable, eq(evaluationPredictionsTable.historicalMatchId, historicalMatchesTable.id))
    .where(
      and(
        eq(evaluationPredictionsTable.runKind, "historical_test"),
        eq(evaluationPredictionsTable.segment, "validation"),
        eq(evaluationPredictionsTable.includedInAccuracy, true),
        eq(historicalMatchesTable.tour, segment.tour),
        eq(historicalMatchesTable.surface, segment.surface),
      ),
    );

  const points: CalibrationPoint[] = rows
    .filter((r) => r.rawProbability !== null && r.actualWinnerId !== null)
    .map((r) => ({ rawProbability: (r.rawProbability as number) / 100, outcome: (r.actualWinnerId === r.player1Id ? 1 : 0) as 0 | 1 }));

  if (points.length < MIN_VALIDATION_SAMPLES_FOR_SEGMENT) {
    return {
      ...base,
      meetsThreshold: false,
      validationSampleSize: points.length,
      accuracy: null,
      logLoss: null,
      brier: null,
      generalAccuracy: null,
      generalLogLoss: null,
      generalBrier: null,
      calibrationMapping: [],
      weight: 0,
    };
  }

  // Task #151: was `fitIsotonicCalibration(points)` fit AND scored on the exact same points --
  // in-sample, unlike the pooled/general model (`fitBestCalibration`), which always fits on a
  // held-out-aware split. The 2026-07-13 ablation report caught the consequence: the Active
  // Segment Specialist looked well-calibrated at fit time (this in-sample scoring) but was
  // measurably overconfident when replayed against fresh matches (60.1% predicted vs. 56.8%
  // observed, n=2,036, 3.3pt gap). Switched to the same holdout-validated `fitBestCalibration`
  // pipeline the general model uses (isotonic vs. Platt, picked by genuinely held-out log loss +
  // ECE) so a segment gets exactly the same non-overfit treatment.
  //
  // Task #157 re-check (2026-07-15, docs/audit-task157-confidence-discount-revalidation.md): this
  // fix is currently UNVERIFIABLE against live/backtest data -- `specialist_models` has zero rows
  // in the current environment (no walk-forward run has called `computeAndStoreSpecialistSegments`
  // since this fix landed), confirmed by a fresh ablation replay where the Active Segment
  // Specialist voted on zero matches. Populating it requires a real walk-forward run, which was
  // deliberately NOT triggered here: `runWalkForwardEvaluation` wipes all prior evaluation history
  // on every call (Task #135, still open), so running it just to satisfy this check would trade a
  // small verification gap for a much bigger, unrelated one. See the audit doc for the follow-up.
  const fitResult = fitBestCalibration(points);
  const segmentMapping = fitResult.knots;

  // Score against the SAME held-out slice `fitBestCalibration` used to pick its method -- never
  // the points the curve was fit on, so this reported accuracy/logLoss/brier (and the weight
  // derived from them below) are a fair, non-overfit comparison against the general mapping.
  // `splitForCalibrationHoldout` is deterministic (rank-based, no RNG), so calling it again here
  // reproduces the exact same split `fitBestCalibration` used internally. Below ~125 validation
  // points there isn't enough data to hold a meaningful slice back at all (the same floor
  // `splitForCalibrationHoldout` itself applies) -- degrades to the prior in-sample scoring
  // rather than fabricating a comparison on a slice too small to trust, matching
  // `fitBestCalibration`'s own documented fallback.
  const { holdoutPoints } = splitForCalibrationHoldout(points);
  const scoringPoints = holdoutPoints.length > 0 ? holdoutPoints : points;

  const segmentPredictions = scoringPoints.map((p) => ({ ...p, calibrated: applyCalibration(segmentMapping, p.rawProbability) }));
  const generalPredictions = scoringPoints.map((p) => ({ ...p, calibrated: applyCalibration(generalMapping, p.rawProbability) }));

  const segmentAccuracy = accuracyOf(segmentPredictions);
  const generalAccuracy = accuracyOf(generalPredictions);
  const segmentLogLoss = logLoss(segmentPredictions.map((p) => ({ rawProbability: p.calibrated, outcome: p.outcome })));
  const generalLogLoss = logLoss(generalPredictions.map((p) => ({ rawProbability: p.calibrated, outcome: p.outcome })));
  const segmentBrier = brierScore(segmentPredictions.map((p) => ({ rawProbability: p.calibrated, outcome: p.outcome })));
  const generalBrier = brierScore(generalPredictions.map((p) => ({ rawProbability: p.calibrated, outcome: p.outcome })));

  return {
    ...base,
    meetsThreshold: true,
    validationSampleSize: points.length,
    accuracy: segmentAccuracy,
    logLoss: segmentLogLoss,
    brier: segmentBrier,
    generalAccuracy,
    generalLogLoss,
    generalBrier,
    calibrationMapping: segmentMapping,
    weight: computeSpecialistWeight(points.length, segmentLogLoss, generalLogLoss),
  };
}

function accuracyOf(predictions: Array<{ calibrated: number; outcome: 0 | 1 }>): number | null {
  if (predictions.length === 0) return null;
  const correct = predictions.filter((p) => (p.calibrated >= 0.5 ? 1 : 0) === p.outcome).length;
  return Math.round((correct / predictions.length) * 1000) / 10;
}

/**
 * Derives the specialist's share (0-1) of the live blend purely from measured validation
 * performance -- never hand-picked or tuned against any later test window.
 *
 * `baseWeight` grows with sample size (more validation data earns more trust, asymptoting at 0.7
 * so the general model always retains at least some say). `perfAdjustment` then shifts that base
 * up when the segment's own calibration measurably beats the general mapping's logLoss on the
 * same points, or down when it's worse -- capped at +/-0.2 so one segment's noisy logLoss swing
 * can't flip the blend to an extreme. The result is clamped to [0.1, 0.85]: even a strong
 * specialist never fully silences the general model's agreement check, and even a weak one still
 * contributes a signal worth voting on transparency's sake.
 */
function computeSpecialistWeight(sampleSize: number, segmentLogLoss: number | null, generalLogLoss: number | null): number {
  const baseWeight = Math.min(0.7, sampleSize / (sampleSize + 50));
  if (segmentLogLoss === null || generalLogLoss === null) return Math.round(Math.max(0.1, Math.min(0.85, baseWeight)) * 1000) / 1000;

  const improvement = generalLogLoss - segmentLogLoss; // positive => segment calibrates better
  const perfAdjustment = Math.max(-0.2, Math.min(0.2, (improvement / 0.05) * 0.2));
  return Math.round(Math.max(0.1, Math.min(0.85, baseWeight + perfAdjustment)) * 1000) / 1000;
}

export async function getActiveSpecialistSegments(): Promise<SpecialistSegmentSummary[]> {
  return db.select().from(specialistModelsTable);
}

export async function getSpecialistForSegment(segmentKeyValue: string): Promise<SpecialistSegmentSummary | null> {
  const [row] = await db.select().from(specialistModelsTable).where(eq(specialistModelsTable.segmentKey, segmentKeyValue)).limit(1);
  return row ?? null;
}

/**
 * Resolves the caller-facing `SegmentSpecialistInput` the prediction engine expects, for a given
 * tour/surface. Returns null when the tour/surface isn't one of Phase 6's candidate segments at
 * all (e.g. Challenger/ITF/Exhibition, or an unrecognized surface) -- distinct from a resolved
 * segment that just hasn't cleared its data threshold yet, which still returns an object (with
 * `meetsThreshold: false`) so the engine can show a specific, honest disclaimer either way.
 */
export async function resolveSegmentSpecialistInput(tour: string | null | undefined, surface: Surface | null | undefined): Promise<SegmentSpecialistInput | null> {
  const segment = resolveSegment(tour, surface);
  if (!segment) return null;
  const row = await getSpecialistForSegment(segment.segmentKey);
  return toSegmentSpecialistInput(segment, row);
}

/**
 * Pure, DB-free version of the mapping `resolveSegmentSpecialistInput` does, given a row already
 * in hand (or null). Factored out so callers who need to resolve this for thousands of matches in
 * one run (Task #65: walk-forward scoring) can preload every segment's row ONCE up front instead
 * of round-tripping the DB per match.
 */
export function toSegmentSpecialistInput(segment: SegmentDefinition, row: SpecialistModelRow | null): SegmentSpecialistInput {
  if (!row) {
    // No walk-forward run has ever computed this segment yet -- same honest "not enough data"
    // disclaimer as a segment that was computed but fell short of threshold.
    return {
      segmentKey: segment.segmentKey,
      label: segment.label,
      meetsThreshold: false,
      historicalMatchCount: 0,
      validationSampleSize: 0,
      minHistoricalMatches: MIN_HISTORICAL_MATCHES_FOR_SEGMENT,
      minValidationSamples: MIN_VALIDATION_SAMPLES_FOR_SEGMENT,
    };
  }

  return {
    segmentKey: row.segmentKey,
    label: row.label,
    meetsThreshold: row.meetsThreshold,
    historicalMatchCount: row.historicalMatchCount,
    validationSampleSize: row.validationSampleSize,
    minHistoricalMatches: MIN_HISTORICAL_MATCHES_FOR_SEGMENT,
    minValidationSamples: MIN_VALIDATION_SAMPLES_FOR_SEGMENT,
    calibrationMapping: row.meetsThreshold ? (row.calibrationMapping as CalibrationKnot[]) : undefined,
    weight: row.meetsThreshold ? row.weight : undefined,
  };
}

/**
 * Sync counterpart of `resolveSegmentSpecialistInput` for callers holding a preloaded
 * segmentKey -> row map (Task #65's walk-forward scoring). Returns null under the exact same
 * condition `resolveSegmentSpecialistInput` would (tour/surface isn't a candidate segment at
 * all), never a fabricated "not enough data" result for a non-candidate segment.
 */
export function resolveSegmentSpecialistInputSync(
  tour: string | null | undefined,
  surface: Surface | null | undefined,
  rowsBySegmentKey: ReadonlyMap<string, SpecialistModelRow>,
): SegmentSpecialistInput | null {
  const segment = resolveSegment(tour, surface);
  if (!segment) return null;
  return toSegmentSpecialistInput(segment, rowsBySegmentKey.get(segment.segmentKey) ?? null);
}
