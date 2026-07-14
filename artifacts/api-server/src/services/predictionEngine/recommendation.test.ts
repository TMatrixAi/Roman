import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRecommendation } from "./recommendation";

test("STRONG_RECOMMENDATION requires high margin + high data quality + low/moderate upset risk + strong-enough model agreement", () => {
  const result = computeRecommendation(85, 70, "Strong", "LOW", "Strong");
  assert.equal(result, "STRONG_RECOMMENDATION");
});

test("STRONG_RECOMMENDATION is withheld when model agreement is HighDisagreement, even with high margin/data quality/low risk", () => {
  // Regression test: previously STRONG_RECOMMENDATION only checked margin, data quality, and
  // upset risk -- not model agreement -- so a match where the core models genuinely disagree
  // could still be labeled a strong recommendation.
  const result = computeRecommendation(85, 70, "Strong", "LOW", "HighDisagreement");
  assert.notEqual(result, "STRONG_RECOMMENDATION", "HighDisagreement must block STRONG_RECOMMENDATION regardless of margin/data quality/risk");
});

test("STRONG_RECOMMENDATION is withheld when model agreement is Mixed, even with high margin/data quality/low risk", () => {
  const result = computeRecommendation(85, 70, "Strong", "MODERATE", "Mixed");
  assert.notEqual(result, "STRONG_RECOMMENDATION", "Mixed agreement must block STRONG_RECOMMENDATION regardless of margin/data quality/risk");
});

test("STRONG_RECOMMENDATION still fires with Moderate model agreement (only Mixed/HighDisagreement block it)", () => {
  const result = computeRecommendation(85, 70, "Strong", "LOW", "Moderate");
  assert.equal(result, "STRONG_RECOMMENDATION");
});

test("DO_NOT_RECOMMEND still takes priority over everything else on poor data quality", () => {
  const result = computeRecommendation(85, 20, "Poor", "LOW", "Strong");
  assert.equal(result, "DO_NOT_RECOMMEND");
});

test("NO_STRONG_SIGNAL still fires for a near-coin-flip margin with Mixed/HighDisagreement agreement", () => {
  const result = computeRecommendation(52, 70, "Strong", "LOW", "HighDisagreement");
  assert.equal(result, "NO_STRONG_SIGNAL");
});

test("HIGH_RISK still fires on EXTREME upset risk regardless of agreement", () => {
  const result = computeRecommendation(85, 70, "Strong", "EXTREME", "Strong");
  assert.equal(result, "HIGH_RISK");
});

test("a high-margin match that fails the agreement check but not the margin-only MODERATE_LEAN threshold falls back to MODERATE_LEAN, not HIGH_RISK", () => {
  // margin=30 >= 22 (would have been STRONG) but HighDisagreement blocks it; margin >= 10 still
  // qualifies for MODERATE_LEAN.
  const result = computeRecommendation(80, 70, "Strong", "LOW", "HighDisagreement");
  assert.equal(result, "MODERATE_LEAN");
});

test("margin 8-10 with LOW upset risk and Moderate agreement is MODERATE_LEAN, not HIGH_RISK (regression: previously fell through the catch-all)", () => {
  // margin = 8.7, matches the real S. Johnson case that surfaced this bug.
  const result = computeRecommendation(58.7, 70, "Good", "LOW", "Moderate");
  assert.equal(result, "MODERATE_LEAN");
});

test("margin exactly 8 with MODERATE upset risk and Strong agreement is MODERATE_LEAN (lower boundary of the new band)", () => {
  const result = computeRecommendation(58, 70, "Good", "MODERATE", "Strong");
  assert.equal(result, "MODERATE_LEAN");
});

test("margin just under 8 with Strong agreement (so NOT caught by NO_STRONG_SIGNAL) still falls through to HIGH_RISK -- the new rule must not swallow sub-8 margins", () => {
  const result = computeRecommendation(57.9, 70, "Good", "LOW", "Strong");
  assert.equal(result, "HIGH_RISK");
});

test("margin 8-10 with HighDisagreement agreement is NOT rescued by the new rule -- still HIGH_RISK (agreement gate must still apply)", () => {
  const result = computeRecommendation(58.7, 70, "Good", "LOW", "HighDisagreement");
  assert.equal(result, "HIGH_RISK");
});

test("margin 8-10 with EXTREME upset risk is still HIGH_RISK via the earlier EXTREME rule, not reclassified by the new band", () => {
  const result = computeRecommendation(58.7, 70, "Good", "EXTREME", "Strong");
  assert.equal(result, "HIGH_RISK");
});
