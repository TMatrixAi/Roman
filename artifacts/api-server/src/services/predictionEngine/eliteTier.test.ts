import test from "node:test";
import assert from "node:assert/strict";
import { computeEliteTier, type EliteTierInputs } from "./eliteTier";

function baseInputs(overrides: Partial<EliteTierInputs> = {}): EliteTierInputs {
  return {
    dataQuality: 80,
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
