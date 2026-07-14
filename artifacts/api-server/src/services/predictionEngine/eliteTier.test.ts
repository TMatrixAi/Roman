import test from "node:test";
import assert from "node:assert/strict";
import { computeEliteTier, type EliteTierInputs } from "./eliteTier";

function baseInputs(overrides: Partial<EliteTierInputs> = {}): EliteTierInputs {
  return {
    dataQuality: 80,
    calibratedProbability: 70,
    surfaceEloFavorsPlayer1: true,
    serveReturnFavorsPlayer1: true,
    recentFormFavorsPlayer1: true,
    specialistApplied: true,
    segmentLabel: "ATP-Hard",
    modelConflict: false,
    modelAgreement: "Strong",
    upsetRisk: "LOW",
    ...overrides,
  };
}

test("every condition satisfied, including the new consistency guardrail, earns Elite", () => {
  const { isEliteTier, reason } = computeEliteTier(baseInputs());
  assert.equal(isEliteTier, true);
  assert.match(reason, /Elite:/);
});

test("High Disagreement withholds Elite with a visible reason, without this function touching the risk label itself", () => {
  const { isEliteTier, reason } = computeEliteTier(baseInputs({ modelAgreement: "HighDisagreement" }));
  assert.equal(isEliteTier, false);
  assert.match(reason, /High Disagreement/);
  assert.match(reason, /not suppressed/);
});

test("HIGH upset risk withholds Elite", () => {
  const { isEliteTier, reason } = computeEliteTier(baseInputs({ upsetRisk: "HIGH" }));
  assert.equal(isEliteTier, false);
  assert.match(reason, /upset risk is HIGH/);
});

test("EXTREME upset risk withholds Elite", () => {
  const { isEliteTier } = computeEliteTier(baseInputs({ upsetRisk: "EXTREME" }));
  assert.equal(isEliteTier, false);
});

test("MODERATE upset risk alone does not withhold Elite -- only High/Extreme do", () => {
  const { isEliteTier } = computeEliteTier(baseInputs({ upsetRisk: "MODERATE" }));
  assert.equal(isEliteTier, true);
});

test("pre-existing gates (data quality, 3-signal agreement, specialist, model conflict) still work unchanged", () => {
  assert.equal(computeEliteTier(baseInputs({ dataQuality: 40 })).isEliteTier, false);
  assert.equal(computeEliteTier(baseInputs({ recentFormFavorsPlayer1: false })).isEliteTier, false);
  assert.equal(computeEliteTier(baseInputs({ specialistApplied: false })).isEliteTier, false);
  assert.equal(computeEliteTier(baseInputs({ modelConflict: true })).isEliteTier, false);
});

// Task #66: three signals agreeing on DIRECTION alone (e.g. each barely above 50%) isn't real
// evidence -- the final calibrated pick must also clear a minimum margin from a coin flip.
test("a near-coin-flip calibrated probability withholds Elite even when all three signals agree on direction", () => {
  const { isEliteTier, reason } = computeEliteTier(baseInputs({ calibratedProbability: 52 }));
  assert.equal(isEliteTier, false);
  assert.match(reason, /coin flip/);
});

test("a calibrated probability right at the margin floor earns Elite; just under it does not", () => {
  assert.equal(computeEliteTier(baseInputs({ calibratedProbability: 55 })).isEliteTier, true);
  assert.equal(computeEliteTier(baseInputs({ calibratedProbability: 54.9 })).isEliteTier, false);
});

test("the margin gate is symmetric -- a strong lean toward player2 (calibratedProbability far below 50) also earns Elite", () => {
  assert.equal(computeEliteTier(baseInputs({ calibratedProbability: 30 })).isEliteTier, true);
});
