import test from "node:test";
import assert from "node:assert/strict";
import type { EvaluationPredictionRow } from "@workspace/db";
import { computeUpsetRiskTierMetrics, computeDisagreementTierMetrics, computeECE, MIN_ECE_BUCKET_SAMPLE } from "./metrics";
import type { CalibrationPoint } from "./calibration";

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

function point(rawProbability: number, outcome: 0 | 1): CalibrationPoint {
  return { rawProbability, outcome };
}

test("computeECE excludes buckets below MIN_ECE_BUCKET_SAMPLE so a single lucky/unlucky point can't dominate the metric", () => {
  // 55-60% bucket: 20 points, well-calibrated (avg confidence ~57.5%, accuracy 60%) -- small,
  // unremarkable gap.
  const wellCalibratedBucket: CalibrationPoint[] = Array.from({ length: 20 }, (_, i) => point(0.575, i < 12 ? 1 : 0));
  // 80-85% bucket: a single point, wrong -- in isolation this is 0% observed accuracy against
  // 82% confidence, a huge gap, but n=1 can't support that conclusion (Task #66 near-Elite
  // backtest investigation: this exact pattern inflated ECE on a real ~500-row cohort via a few
  // near-empty high-confidence buckets).
  const sparseBucket: CalibrationPoint[] = [point(0.82, 0)];

  const eceWithoutSparse = computeECE(wellCalibratedBucket);
  const eceWithSparse = computeECE([...wellCalibratedBucket, ...sparseBucket]);

  // The sparse, sub-floor bucket must be excluded entirely -- adding it should not move ECE at all.
  assert.equal(eceWithSparse, eceWithoutSparse);
  assert.ok(eceWithoutSparse !== null && eceWithoutSparse < 0.05, `expected the well-calibrated bucket alone to read well-calibrated, got ${eceWithoutSparse}`);
});

test("computeECE counts a bucket once it reaches MIN_ECE_BUCKET_SAMPLE", () => {
  assert.equal(MIN_ECE_BUCKET_SAMPLE, 5);
  const atFloor: CalibrationPoint[] = Array.from({ length: MIN_ECE_BUCKET_SAMPLE }, () => point(0.9, 0)); // 90% confidence, always wrong
  const ece = computeECE(atFloor);
  assert.ok(ece !== null && ece > 0.5, `expected a fully-miscalibrated at-floor bucket to score a large ECE, got ${ece}`);
});

test("computeECE returns null when every bucket is below the sample floor", () => {
  const tooSparse: CalibrationPoint[] = [point(0.6, 1), point(0.9, 0)];
  assert.equal(computeECE(tooSparse), null);
});
