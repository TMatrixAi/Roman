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
   * The currently active Phase 4 isotonic calibration mapping (fitted from real walk-forward
   * validation data), pre-fetched by the caller. When present, this is used in place of the
   * engine's own dataQuality-based heuristic shrink -- a real, data-validated calibration beats a
   * hand-tuned stand-in. Omit/empty to fall back to the heuristic (e.g. before any evaluation run
   * has ever produced a fitted model).
   */
  activeCalibration?: CalibrationKnot[] | null;
}
