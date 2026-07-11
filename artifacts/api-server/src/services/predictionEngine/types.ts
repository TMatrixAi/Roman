import type { MatchFormat, MatchRecord, PlayerProfile, Surface, HeadToHeadRecord } from "../tennisData/types";
import type { OpponentEloLookup } from "./opponentStrength";
import type { WeatherConditions } from "./weather";
import type { CalibrationKnot } from "../evaluation/types";

/** Standard shape returned by every engine module. */
export interface ModuleResult {
  player1Edge: number; // signed edge toward player 1, roughly -50..50
  player2Edge: number;
  reliability: number; // 0-100
  summary: string;
  warnings: string[];
}

export interface PredictionEngineInput {
  player1: PlayerProfile;
  player2: PlayerProfile;
  player1Matches: MatchRecord[];
  player2Matches: MatchRecord[];
  headToHead: HeadToHeadRecord;
  surface: Surface;
  matchFormat: MatchFormat;
  /**
   * Real opponent-strength estimates (from Phase 3's historical Elo store), pre-resolved by the
   * caller via `resolveOpponentStrength` -- the engine itself stays synchronous/DB-free. Omit or
   * pass empty maps to fall back to the pre-Phase-5, opponent-neutral behavior.
   */
  player1OpponentElo?: OpponentEloLookup;
  player2OpponentElo?: OpponentEloLookup;
  /**
   * Real forecast conditions for a genuinely upcoming fixture with a known venue, pre-resolved by
   * the caller via `getUpcomingConditions`. Informational only -- never used to adjust the
   * ensemble's probability. Null/omitted means "not available", never a guess.
   */
  weather?: WeatherConditions | null;
  /**
   * The tournament name for this match, used only to look up real venue coordinates (via
   * `venueMap.ts`, the same static lookup weather uses) for the rest/travel signals in
   * `availability.ts`. Omit/null when unknown -- travel distance simply reports as unavailable,
   * never a guess.
   */
  tournamentName?: string | null;
  /**
   * The currently active Phase 4 isotonic calibration mapping (fitted from real walk-forward
   * validation data), pre-fetched by the caller. When present, this is used in place of the
   * engine's own dataQuality-based heuristic shrink -- a real, data-validated calibration beats a
   * hand-tuned stand-in. Omit/empty to fall back to the heuristic (e.g. before any evaluation run
   * has ever produced a fitted model).
   */
  activeCalibration?: CalibrationKnot[] | null;
  /**
   * Phase 6 tour/surface specialist for this match's segment, pre-resolved by the caller (mirrors
   * the `activeCalibration` pattern -- the engine stays sync/DB-free). Omit/null when the match's
   * tour isn't one of Phase 6's candidate segments at all (e.g. Challenger/ITF/Exhibition) --
   * distinct from a *resolved* segment that simply doesn't meet its data threshold yet
   * (`meetsThreshold: false`), so the engine can surface an honest, specific disclaimer either way
   * instead of silently doing the same thing for two different reasons.
   */
  segment?: SegmentSpecialistInput | null;
  /**
   * Phase 7: whether the Monte Carlo point-by-point simulator has been validated (against real
   * historical/live outcomes) well enough to earn a vote in the ensemble, pre-resolved by the
   * caller (mirrors the `segment` pattern -- the engine stays sync/DB-free). Omit/null to fall
   * back to "not yet validated" -- the simulation is still computed and shown, just not blended
   * into calibratedProbability.
   */
  simulatorAdoption?: SimulatorAdoptionInput | null;
}

export interface SimulatorAdoptionInput {
  /** True only once the simulator has cleared its own sample-size threshold AND measurably improved on the general model's logLoss on real graded outcomes. */
  adopted: boolean;
  /** This simulator's measured blend weight (0-1) against the rest of the ensemble. Present only when `adopted` is true. */
  weight?: number;
  sampleSize: number;
  minSampleSize: number;
  /** Always present -- explains why the simulator is or isn't voting yet, never silent. */
  note: string;
}

export interface SegmentSpecialistInput {
  segmentKey: string;
  label: string;
  meetsThreshold: boolean;
  historicalMatchCount: number;
  validationSampleSize: number;
  minHistoricalMatches: number;
  minValidationSamples: number;
  /** Present only when `meetsThreshold` is true. */
  calibrationMapping?: CalibrationKnot[];
  /** This segment's measured blend weight (0-1) against the general model. Present only when `meetsThreshold` is true. */
  weight?: number;
}
