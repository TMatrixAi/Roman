import { test } from "node:test";
import assert from "node:assert/strict";
import { computeUpsetRisk } from "./upsetRisk";

test("margin >= 30 with agreement other than HighDisagreement is LOW (previously required exactly Strong)", () => {
  assert.equal(computeUpsetRisk(82, "Strong"), "LOW");
  assert.equal(computeUpsetRisk(82, "Moderate"), "LOW");
  assert.equal(computeUpsetRisk(82, "Mixed"), "LOW");
});

test("margin >= 18 and < 30 with agreement other than HighDisagreement is MODERATE (previously Mixed fell through to HIGH)", () => {
  assert.equal(computeUpsetRisk(70, "Strong"), "MODERATE");
  assert.equal(computeUpsetRisk(70, "Moderate"), "MODERATE");
  assert.equal(computeUpsetRisk(70, "Mixed"), "MODERATE");
});

test("margin >= 8 and < 18 is HIGH regardless of agreement, except HighDisagreement escalates it", () => {
  assert.equal(computeUpsetRisk(60, "Strong"), "HIGH");
  assert.equal(computeUpsetRisk(60, "HighDisagreement"), "EXTREME");
});

test("margin < 8 is always EXTREME -- already the worst tier, so HighDisagreement cannot escalate further", () => {
  assert.equal(computeUpsetRisk(53, "Strong"), "EXTREME");
  assert.equal(computeUpsetRisk(53, "HighDisagreement"), "EXTREME");
});

test("HighDisagreement never jumps more than one tier worse than the real margin-derived base tier", () => {
  // margin 82 -> base LOW; HighDisagreement should land on MODERATE, not skip straight to EXTREME
  assert.equal(computeUpsetRisk(82, "HighDisagreement"), "MODERATE");
  // margin 70 -> base MODERATE; HighDisagreement should land on HIGH, not EXTREME
  assert.equal(computeUpsetRisk(70, "HighDisagreement"), "HIGH");
});

test("is symmetric around 50 -- underdog-favoring probabilities use the same margin logic", () => {
  assert.equal(computeUpsetRisk(18, "Strong"), "LOW");
  assert.equal(computeUpsetRisk(30, "Strong"), "MODERATE");
});
