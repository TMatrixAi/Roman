import type { CalibrationKnot } from "./types";

export interface CalibrationPoint {
  /** Raw predicted probability that player1 wins, 0-1. */
  rawProbability: number;
  /** 1 if player1 actually won, 0 otherwise. */
  outcome: 0 | 1;
}

/**
 * Fits an isotonic (monotonically non-decreasing) calibration curve via the Pool Adjacent
 * Violators Algorithm (PAVA) -- the standard non-parametric calibration method (used by
 * scikit-learn's IsotonicRegression). Input must be validation-only points; the caller is
 * responsible for never mixing in test/live data here.
 *
 * Returns knots sorted ascending by x (raw probability). Apply with `applyCalibration`, which
 * linearly interpolates between knots and clamps outside the observed range -- so calibration
 * never extrapolates into unobserved probability territory.
 */
export function fitIsotonicCalibration(points: CalibrationPoint[]): CalibrationKnot[] {
  if (points.length === 0) {
    // No validation data yet -- identity mapping (no adjustment) rather than a fabricated curve.
    return [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
  }

  const sorted = [...points].sort((a, b) => a.rawProbability - b.rawProbability);

  // PAVA: each pooled block tracks {sumX, sumY, count}; merge adjacent blocks while the running
  // mean would otherwise decrease.
  const blocks: Array<{ sumX: number; sumY: number; count: number }> = [];
  for (const p of sorted) {
    blocks.push({ sumX: p.rawProbability, sumY: p.outcome, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      const lastMean = last.sumY / last.count;
      const prevMean = prev.sumY / prev.count;
      if (prevMean <= lastMean) break;
      prev.sumX += last.sumX;
      prev.sumY += last.sumY;
      prev.count += last.count;
      blocks.pop();
    }
  }

  const knots: CalibrationKnot[] = blocks.map((b) => ({ x: b.sumX / b.count, y: b.sumY / b.count }));

  // Anchor the ends to the full observed range so interpolation covers every raw probability
  // that was actually seen in validation.
  if (knots[0].x > 0) knots.unshift({ x: 0, y: knots[0].y });
  if (knots[knots.length - 1].x < 1) knots.push({ x: 1, y: knots[knots.length - 1].y });

  return knots;
}

/** Applies a fitted isotonic mapping to a new raw probability via linear interpolation, clamped to [0,1]. */
export function applyCalibration(mapping: CalibrationKnot[], rawProbability: number): number {
  const x = Math.max(0, Math.min(1, rawProbability));
  if (mapping.length === 0) return x;
  if (x <= mapping[0].x) return mapping[0].y;
  if (x >= mapping[mapping.length - 1].x) return mapping[mapping.length - 1].y;

  for (let i = 0; i < mapping.length - 1; i++) {
    const a = mapping[i];
    const b = mapping[i + 1];
    if (x >= a.x && x <= b.x) {
      if (b.x === a.x) return a.y;
      const t = (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return x;
}

export function logLoss(points: CalibrationPoint[]): number | null {
  if (points.length === 0) return null;
  const eps = 1e-9;
  let sum = 0;
  for (const p of points) {
    const prob = Math.max(eps, Math.min(1 - eps, p.rawProbability));
    sum += p.outcome === 1 ? -Math.log(prob) : -Math.log(1 - prob);
  }
  return sum / points.length;
}

export function brierScore(points: CalibrationPoint[]): number | null {
  if (points.length === 0) return null;
  const sum = points.reduce((acc, p) => acc + (p.rawProbability - p.outcome) ** 2, 0);
  return sum / points.length;
}
