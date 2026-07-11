import type { EngineBreakdown } from "../predictionEngine";

/** Bumped whenever the reduced-feature historical scoring model's logic changes. */
export const HISTORICAL_MODEL_VERSION = "phase4-historical-v1";
/** Bumped whenever the live ensemble engine (predictionEngine/index.ts) materially changes. */
export const LIVE_MODEL_VERSION = "phase4-live-ensemble-v1";

export type RunKind = "historical_test" | "paper_trade" | "live";
export type Segment = "validation" | "test";
export type PredictionStatus = "pending" | "graded" | "void" | "missed";
export type ResultType = "normal" | "retired" | "walkover" | "cancelled";
export type RetirementRule = "excluded" | "included";

/**
 * Feature snapshot stored for a historical_test row -- honestly limited to the reduced feature
 * set Phase 3's leak-proof backfill actually captured per player (Elo, form, sample size). This
 * is NOT the same shape as the full live EngineBreakdown -- reproducing every live module
 * (serve/return splits, style matchup, live H2H) would require backfilling much richer
 * per-match stats than Phase 3 stores today. That gap is deliberate scope, not an oversight.
 */
export interface HistoricalFeatureSnapshot {
  modelVersion: typeof HISTORICAL_MODEL_VERSION;
  player1: PlayerReducedFeatures;
  player2: PlayerReducedFeatures;
  eloEdge: number;
  formEdge: number;
  gameShareEdge: number;
}

export interface PlayerReducedFeatures {
  matchesPlayed: number;
  eloOverall: number | null;
  eloSurface: number | null;
  winPctLast10: number | null;
  gameShareLast10: number | null;
}

/** Feature snapshot stored for a paper_trade/live row: the real, full live engine breakdown. */
export interface LiveFeatureSnapshot {
  modelVersion: typeof LIVE_MODEL_VERSION;
  engine: EngineBreakdown;
  preCalibrationProbability: number;
}

export interface CalibrationKnot {
  x: number;
  y: number;
}
