import type { MatchFormat, MatchRecord, PlayerProfile, Surface, HeadToHeadRecord } from "../tennisData/types";

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
}
