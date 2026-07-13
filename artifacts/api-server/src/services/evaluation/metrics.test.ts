import test from "node:test";
import assert from "node:assert/strict";
import type { EvaluationPredictionRow } from "@workspace/db";
import { computeUpsetRiskTierMetrics, computeDisagreementTierMetrics } from "./metrics";

let nextId = 1;

function row(overrides: Partial<EvaluationPredictionRow> = {}): EvaluationPredictionRow {
  return {
    id: nextId++,
    runKind: "historical_test",
    foldId: null,
    segment: "test",
    historicalMatchId: null,
    provider: null,
    externalFixtureId: null,
    player1Id: "p1",
    player1Name: "Player One",
    player2Id: "p2",
    player2Name: "Player Two",
    surface: "Hard",
    matchFormat: "BestOf3",
    tournamentLevel: "ATP250",
    tournamentName: "Fixture Open",
    scheduledStartAt: new Date("2026-01-01T00:00:00Z"),
    cutoffAt: new Date("2025-12-31T00:00:00Z"),
    lockedAt: new Date("2025-12-31T00:00:00Z"),
    modelVersion: "test",
    featureSnapshot: null,
    modelAgreement: null,
    upsetRiskTier: null,
    rawProbability: 60,
    calibratedProbability: 60,
    predictedWinnerId: "p1",
    predictedWinnerName: "Player One",
    status: "graded",
    actualWinnerId: "p1",
    actualWinnerName: "Player One",
    resultType: "normal",
    includedInAccuracy: true,
    gradedAt: new Date("2026-01-01T02:00:00Z"),
    ...overrides,
  } as EvaluationPredictionRow;
}

test("computeUpsetRiskTierMetrics returns all four tiers with n=0/null for tiers with no rows", () => {
  const result = computeUpsetRiskTierMetrics([]);
  assert.deepEqual(
    result.map((r) => r.tier),
    ["LOW", "MODERATE", "HIGH", "EXTREME"],
  );
  for (const tierResult of result) {
    assert.equal(tierResult.n, 0);
    assert.equal(tierResult.favoriteLossRate, null);
  }
});

test("computeUpsetRiskTierMetrics computes favorite-loss-rate per tier from accuracy-eligible rows only", () => {
  const rows = [
    row({ upsetRiskTier: "LOW", actualWinnerId: "p1", predictedWinnerId: "p1" }), // favorite won
    row({ upsetRiskTier: "LOW", actualWinnerId: "p1", predictedWinnerId: "p1" }),
    row({ upsetRiskTier: "EXTREME", actualWinnerId: "p2", predictedWinnerId: "p1" }), // favorite lost
    row({ upsetRiskTier: "EXTREME", actualWinnerId: "p1", predictedWinnerId: "p1" }),
    // excluded: not accuracy-eligible, must not count toward EXTREME's rate
    row({ upsetRiskTier: "EXTREME", includedInAccuracy: false, actualWinnerId: "p2", predictedWinnerId: "p1" }),
    // excluded: no persisted tier (pre-Task-56 row)
    row({ upsetRiskTier: null, actualWinnerId: "p2", predictedWinnerId: "p1" }),
  ];

  const result = computeUpsetRiskTierMetrics(rows);
  const low = result.find((r) => r.tier === "LOW")!;
  const extreme = result.find((r) => r.tier === "EXTREME")!;

  assert.equal(low.n, 2);
  assert.equal(low.favoriteLossRate, 0);
  assert.equal(extreme.n, 2);
  assert.equal(extreme.favoriteLossRate, 50);
});

test("computeDisagreementTierMetrics returns all four tiers and computes accuracy/errorRate correctly", () => {
  const rows = [
    row({ modelAgreement: "Strong", actualWinnerId: "p1", predictedWinnerId: "p1" }),
    row({ modelAgreement: "Strong", actualWinnerId: "p1", predictedWinnerId: "p1" }),
    row({ modelAgreement: "Strong", actualWinnerId: "p2", predictedWinnerId: "p1" }),
    row({ modelAgreement: "HighDisagreement", actualWinnerId: "p2", predictedWinnerId: "p1" }),
    row({ modelAgreement: "HighDisagreement", actualWinnerId: "p2", predictedWinnerId: "p1" }),
  ];

  const result = computeDisagreementTierMetrics(rows);
  assert.deepEqual(
    result.map((r) => r.tier),
    ["Strong", "Moderate", "Mixed", "HighDisagreement"],
  );

  const strong = result.find((r) => r.tier === "Strong")!;
  const highDisagreement = result.find((r) => r.tier === "HighDisagreement")!;
  assert.equal(strong.n, 3);
  assert.equal(strong.accuracy, 66.7);
  assert.equal(strong.errorRate, 33.3);
  assert.equal(highDisagreement.n, 2);
  assert.equal(highDisagreement.accuracy, 0);
  assert.equal(highDisagreement.errorRate, 100);
});
