import { test } from "node:test";
import assert from "node:assert/strict";
import { GetPredictionResponse } from "@workspace/api-zod";

/**
 * Regression guard: predictions saved before the availability module existed have a stored
 * `engine` JSON blob with no `availability` key at all. `availability` must stay optional on
 * EngineBreakdown (see openapi.yaml) or reads of these legacy rows throw instead of rendering.
 */
test("GetPredictionResponse parses a legacy row whose stored engine blob has no availability field", () => {
  const legacyRow = {
    id: 1,
    player1Id: "p1",
    player1Name: "Player One",
    player2Id: "p2",
    player2Name: "Player Two",
    surface: "Hard",
    matchFormat: "BestOf3",
    tournamentName: "Legacy Open",
    predictedWinnerId: "p1",
    predictedWinnerName: "Player One",
    calibratedProbability: 55,
    dataQuality: 68,
    upsetRisk: "MODERATE",
    recommendation: "NO_STRONG_SIGNAL",
    predictedSetScore: "2-1",
    createdAt: new Date().toISOString(),
    engine: {
      surfaceElo: {
        player1SurfaceElo: 1500,
        player2SurfaceElo: 1500,
        eloDifference: 0,
        eloWinProbabilityPlayer1: 50,
        reliability: 100,
        sampleSizePlayer1: 20,
        sampleSizePlayer2: 20,
      },
      serveReturn: {
        player1ServeRating: 50,
        player2ServeRating: 50,
        player1ReturnRating: 50,
        player2ReturnRating: 50,
        reliability: 60,
      },
      recentForm: {
        player1Form: 50,
        player2Form: 50,
        player1Trend: "stable",
        player2Trend: "stable",
        reliability: 100,
      },
      fatigue: {
        player1FatigueScore: 0,
        player2FatigueScore: 0,
        player1MatchesLast7Days: 0,
        player2MatchesLast7Days: 0,
        reliability: 70,
      },
      // `availability` intentionally omitted -- this row predates the module.
      styleMatchup: { player1Styles: [], player2Styles: [], reliability: 50 },
      headToHead: { player1Wins: 0, player2Wins: 0, surfaceMeetings: 0, reliability: 5 },
      models: [],
    },
  };

  const parsed = GetPredictionResponse.parse(legacyRow);
  assert.equal(parsed.engine.availability, undefined);
});
