import { db, calibrationModelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { EngineOutput } from "../predictionEngine";
import { runPredictionEngine } from "../predictionEngine";
import { buildPlayerProfileWarnings } from "../predictionEngine/playerProfileWarnings";
import { resolveOpponentStrength, type OpponentStrengthResolution } from "../predictionEngine/opponentStrength";
import { getUpcomingConditions, type WeatherConditions } from "../predictionEngine/weather";
import type { MatchFormat, MatchRecord, PlayerProfile, Surface, TennisDataProvider, TournamentLevel, HeadToHeadRecord } from "../tennisData";
import { enrichPlayerRankFromSearch, resolvePlayerProfile } from "../tennisData/playerIdentity";
import { resolveSegmentSpecialistInput } from "./specialistWeights";
import { resolveSimulatorAdoption } from "./simulatorValidation";

export interface PredictionSnapshotInput {
  provider: TennisDataProvider;
  player1Id: string;
  player2Id: string;
  surface: Surface;
  matchFormat: MatchFormat;
  tournamentName?: string | null;
  tournamentLevel?: TournamentLevel | null;
  scheduledStartAt?: Date | null;
  includeWeather?: boolean;
}

export interface PredictionSnapshotResult {
  player1: PlayerProfile;
  player2: PlayerProfile;
  player1Matches: MatchRecord[];
  player2Matches: MatchRecord[];
  headToHead: HeadToHeadRecord;
  player1OpponentStrength: OpponentStrengthResolution;
  player2OpponentStrength: OpponentStrengthResolution;
  weather: WeatherConditions | null;
  activeCalibrationId: string | null;
  output: EngineOutput;
}

/**
 * Canonical pre-match snapshot scorer used by both live-search and paper-trading paths.
 * Every caller gets the same profile enrichment, feature assembly, and engine invocation flow.
 */
export async function predictFromSnapshot(input: PredictionSnapshotInput): Promise<PredictionSnapshotResult> {
  const [player1Raw, player2Raw] = await Promise.all([
    resolvePlayerProfile(input.provider, input.player1Id),
    resolvePlayerProfile(input.provider, input.player2Id),
  ]);

  if (!player1Raw || !player2Raw) {
    throw new Error("One or both players could not be found by the data provider");
  }

  const [player1, player2] = await Promise.all([
    enrichPlayerRankFromSearch(input.provider, player1Raw),
    enrichPlayerRankFromSearch(input.provider, player2Raw),
  ]);

  const [player1Matches, player2Matches, headToHead] = await Promise.all([
    input.provider.getPlayerMatches(input.player1Id),
    input.provider.getPlayerMatches(input.player2Id),
    input.provider.getHeadToHead(input.player1Id, input.player2Id),
  ]);

  const matchTour = player1.tour ?? player2.tour;

  const [player1OpponentStrength, player2OpponentStrength, activeCalibrationRow, segment, simulatorAdoption, weather] = await Promise.all([
    resolveOpponentStrength(player1Matches),
    resolveOpponentStrength(player2Matches),
    db.select().from(calibrationModelsTable).where(eq(calibrationModelsTable.active, true)).limit(1),
    resolveSegmentSpecialistInput(matchTour, input.surface),
    resolveSimulatorAdoption(),
    input.includeWeather && input.scheduledStartAt
      ? getUpcomingConditions(input.tournamentName ?? null, input.scheduledStartAt)
      : Promise.resolve(null),
  ]);

  const output = runPredictionEngine({
    player1,
    player2,
    player1Matches,
    player2Matches,
    headToHead,
    surface: input.surface,
    matchFormat: input.matchFormat,
    player1OpponentElo: player1OpponentStrength.lookup,
    player2OpponentElo: player2OpponentStrength.lookup,
    activeCalibration: activeCalibrationRow[0]?.mapping ?? null,
    weather,
    tournamentName: input.tournamentName ?? null,
    tournamentLevel: input.tournamentLevel ?? null,
    segment,
    simulatorAdoption,
  });

  output.engine.warnings.push(...buildPlayerProfileWarnings(player1, player2));

  return {
    player1,
    player2,
    player1Matches,
    player2Matches,
    headToHead,
    player1OpponentStrength,
    player2OpponentStrength,
    weather,
    activeCalibrationId: activeCalibrationRow[0]?.id ? String(activeCalibrationRow[0].id) : null,
    output,
  };
}
