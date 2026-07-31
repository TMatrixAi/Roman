import test from "node:test";
import assert from "node:assert/strict";
import { buildPredictionCopyText } from "./predictionCopyText";

test("buildPredictionCopyText returns the requested compact summary format", () => {
  const text = buildPredictionCopyText({
    player1Id: "p1",
    player1Name: "S. Shin",
    player2Id: "p2",
    player2Name: "Opponent",
    predictedWinnerId: "p1",
    predictedWinnerName: "S. Shin",
    predictedWinnerProbability: 55,
    calibratedProbability: 55,
    recommendation: "MODERATE_LEAN",
    upsetRisk: "MODERATE",
    dataQuality: 78,
    predictedSetScore: "2–1",
    engine: {
      isEliteTier: true,
      headToHead: {
        player1Wins: 0,
        player2Wins: 0,
      },
      simulation: {
        player1WinProbability: 66,
        rangeLow: 61,
        rangeHigh: 71,
      },
    },
  });

  assert.equal(
    text,
    [
      "S. Shin 🥇",
      "",
      "Win%: 55%",
      "Rec: Elite",
      "Upset Risk: Moderate",
      "Data Quality: 78%",
      "Set: 2–1",
      "Monte Carlo: 66%",
      "H2H: 0–0",
      "",
      "🤖 Built with Tennis Matrix AI 🤖",
      "Follow for Launch Updates",
      "𝕏: @TennisMatrixAI",
      "IG: @TennisMatrixAI",
    ].join("\n"),
  );
});

test("buildPredictionCopyText stays compact when simulation and head-to-head are unavailable", () => {
  const text = buildPredictionCopyText({
    player1Id: "p1",
    player1Name: "S. Shin",
    player2Id: "p2",
    player2Name: "Opponent",
    predictedWinnerId: "p1",
    predictedWinnerName: "S. Shin",
    predictedWinnerProbability: 55,
    calibratedProbability: 55,
    recommendation: "HIGH_RISK",
    upsetRisk: "HIGH",
    dataQuality: 78,
    predictedSetScore: "2–1",
    engine: {},
  });

  assert.equal(
    text,
    [
      "S. Shin 🥇",
      "",
      "Win%: 55%",
      "Rec: High Risk",
      "Upset Risk: High",
      "Data Quality: 78%",
      "Set: 2–1",
      "Monte Carlo: —",
      "H2H: —",
      "",
      "🤖 Built with Tennis Matrix AI 🤖",
      "Follow for Launch Updates",
      "𝕏: @TennisMatrixAI",
      "IG: @TennisMatrixAI",
    ].join("\n"),
  );
});
