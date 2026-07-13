import type { HistoricalMatchRow } from "@workspace/db";
import { runPredictionEngine } from "../predictionEngine";
import { resolveOpponentStrengthFromIndex, type EloHistoryIndex } from "../predictionEngine/opponentStrength";
import { reconstructHeadToHead, reconstructPlayerMatchHistory, type MatchHistoryIndex } from "../historicalData/matchRecordReconstruction";
import { LIVE_MODEL_VERSION, type LiveFeatureSnapshot } from "./types";
import type { MatchFormat, PlayerProfile, Surface } from "../tennisData/types";
import type { PlayerIdentityIndex } from "../tennisData/playerIdentity";

/**
 * Everything `scoreHistoricalMatch` needs that's shared across every match in a walk-forward
 * run, preloaded ONCE by the caller (see `walkForward.ts`) instead of re-queried per match --
 * the corpus is small enough (tens of thousands of rows) to hold entirely in memory, and a full
 * run scores thousands of matches, so a per-match DB round-trip for match history/H2H/opponent
 * Elo would turn a run that should take seconds into one that takes hours.
 */
export interface HistoricalScoringContext {
  matchHistory: MatchHistoryIndex;
  eloHistory: EloHistoryIndex;
  /**
   * Task #77: whole-corpus canonical player-identity index, built ONCE per run (see
   * `walkForward.ts`) and passed through here so opponent resolution can canonicalize aliased
   * ids/name variants -- must be the SAME index used to build `eloHistory` (via
   * `buildEloHistoryIndex(identityIndex)`), or a fragmented opponent's history would be
   * canonicalized here but never actually merged in the index itself.
   */
  identityIndex: PlayerIdentityIndex;
}

function minimalProfile(id: string, name: string): PlayerProfile {
  // A historical match row carries only the two player ids/names it was imported with -- rank,
  // country, age, and playing hand are live-standings concepts this row never captured. Every
  // engine module that would use them (e.g. buildPlayerProfileWarnings) already treats an
  // absent field as "unknown", never a fabricated default.
  return { id, name, countryCode: null, currentRank: null, tour: null, age: null, plays: null, fullName: null };
}

/**
 * Scores a historical match by running the exact same live ensemble (`runPredictionEngine`)
 * real paper-trading/live predictions use, fed with real match history reconstructed from
 * Phase 3's leak-proof historical store -- strictly bounded to this match's own frozen
 * `cutoffAt`, so nothing timestamped at or after that instant can leak in.
 *
 * This replaces the earlier, deliberately reduced Elo/form/game-share reconstruction (see the
 * legacy `HistoricalFeatureSnapshot` type in `./types.ts`): walk-forward accuracy now describes
 * the actual model users see when they run a live prediction, not a simplified stand-in for it.
 *
 * Segment specialists, the Phase 7 simulator's adoption vote, live calibration, and weather are
 * always omitted (null/undefined) here -- they are either themselves *outputs* of evaluation
 * (specialists/simulator adoption/calibration are fit FROM walk-forward results, so feeding them
 * back in would be circular) or have no honest historical reconstruction (no archived weather
 * data). This mirrors the engine's own "absent, not faked" contract.
 *
 * Returns null when either player has zero prior recorded matches, or this match's own
 * surface/format weren't resolved at import time -- there is no honest probability to produce in
 * either case, so the caller must treat it as "insufficient data" rather than a fabricated guess.
 */
export function scoreHistoricalMatch(
  match: HistoricalMatchRow,
  context: HistoricalScoringContext,
): { rawProbability: number; snapshot: LiveFeatureSnapshot; modelAgreement: string; upsetRiskTier: string } | null {
  if (!match.surface || !match.matchFormat) return null;
  const surface = match.surface as Surface;
  const matchFormat = match.matchFormat as MatchFormat;

  const player1Matches = reconstructPlayerMatchHistory(context.matchHistory, match.player1Id, match.cutoffAt);
  const player2Matches = reconstructPlayerMatchHistory(context.matchHistory, match.player2Id, match.cutoffAt);
  if (player1Matches.length === 0 || player2Matches.length === 0) return null;

  const player1OpponentStrength = resolveOpponentStrengthFromIndex(player1Matches, context.eloHistory, context.identityIndex);
  const player2OpponentStrength = resolveOpponentStrengthFromIndex(player2Matches, context.eloHistory, context.identityIndex);
  const headToHead = reconstructHeadToHead(context.matchHistory, match.player1Id, match.player2Id, match.cutoffAt);

  const output = runPredictionEngine({
    player1: minimalProfile(match.player1Id, match.player1Name),
    player2: minimalProfile(match.player2Id, match.player2Name),
    player1Matches,
    player2Matches,
    headToHead,
    surface,
    matchFormat,
    player1OpponentElo: player1OpponentStrength.lookup,
    player2OpponentElo: player2OpponentStrength.lookup,
    tournamentName: match.tournamentName,
    weather: null,
    segment: null,
    simulatorAdoption: null,
    activeCalibration: null,
    // Task #77: this is the walk-forward evaluation's own run-scoped scoring path -- the caller
    // (`walkForward.ts`) resets the fallback tracker once at the start of each run, so it's safe
    // to attribute events here. Live/paper-trading/ablation callers must NOT set this (see
    // `PredictionEngineInput.trackEloFallback`'s doc).
    trackEloFallback: true,
  });

  const snapshot: LiveFeatureSnapshot = {
    modelVersion: LIVE_MODEL_VERSION,
    engine: output.engine,
    preCalibrationProbability: output.rawEnsembleProbability,
    dataQuality: output.dataQuality,
    isEliteTier: output.engine.isEliteTier,
  };

  return {
    rawProbability: output.rawEnsembleProbability / 100,
    snapshot,
    modelAgreement: output.engine.modelAgreement,
    upsetRiskTier: output.upsetRisk,
  };
}
