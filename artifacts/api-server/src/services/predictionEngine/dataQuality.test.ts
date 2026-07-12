import test from "node:test";
import assert from "node:assert/strict";
import { computeDataQuality, MODULE_IMPORTANCE } from "./dataQuality";

function modules(overrides: Partial<Record<keyof typeof MODULE_IMPORTANCE, number>>) {
  const defaults: Record<keyof typeof MODULE_IMPORTANCE, number> = {
    surfaceElo: 0,
    serveReturn: 0,
    recentForm: 0,
    availability: 0,
    fatigue: 0,
    headToHead: 0,
  };
  const reliabilities = { ...defaults, ...overrides };
  return (Object.keys(MODULE_IMPORTANCE) as Array<keyof typeof MODULE_IMPORTANCE>).map((key) => ({
    reliability: reliabilities[key],
    importance: MODULE_IMPORTANCE[key],
  }));
}

test("a rare-but-real gap (no head-to-head, no travel data) no longer caps a strong-core-signal match", () => {
  // Strong Elo/Serve&Return/Recent Form, fixed-constant Fatigue, and the two structurally-rare
  // signals (Availability without travel, Head-to-Head with no prior meetings) both low.
  const strongCore = modules({ surfaceElo: 90, serveReturn: 85, recentForm: 80, fatigue: 70, availability: 50, headToHead: 5 });
  const { score, label } = computeDataQuality(strongCore);

  const flatAverage = Math.round((90 + 85 + 80 + 70 + 50 + 5) / 6); // what the old flat average would have produced

  assert.ok(score > flatAverage, `expected weighted score (${score}) to beat the old flat average (${flatAverage})`);
  assert.ok(score >= 65, `expected a match with strong core signals to reach at least "Strong", got ${score}`);
  assert.equal(label, "Strong");
});

test("genuinely weak core signals still score low, even though Fatigue's reliability is a fixed constant", () => {
  const weakCore = modules({ surfaceElo: 20, serveReturn: 20, recentForm: 20, fatigue: 70, availability: 25, headToHead: 5 });
  const { score, label } = computeDataQuality(weakCore);

  assert.ok(score <= 35, `expected genuinely thin data to still score low despite Fatigue's fixed 70, got ${score}`);
  assert.ok(label === "Poor" || label === "Limited", `expected Poor or Limited, got ${label}`);
});

test("strong data across every module still scores Excellent", () => {
  const allStrong = modules({ surfaceElo: 95, serveReturn: 90, recentForm: 90, fatigue: 70, availability: 95, headToHead: 90 });
  const { score, label } = computeDataQuality(allStrong);

  assert.ok(score >= 85, `expected a uniformly strong match to reach Excellent, got ${score}`);
  assert.equal(label, "Excellent");
});

test("Head-to-Head data still meaningfully lifts the score once real meetings exist", () => {
  const noMeetings = computeDataQuality(modules({ surfaceElo: 60, serveReturn: 60, recentForm: 60, fatigue: 70, availability: 60, headToHead: 5 }));
  const manyMeetings = computeDataQuality(modules({ surfaceElo: 60, serveReturn: 60, recentForm: 60, fatigue: 70, availability: 60, headToHead: 90 }));

  assert.ok(manyMeetings.score > noMeetings.score, "real head-to-head history should still raise the score, just not dominate its absence");
});

test("an all-zero input produces the lowest score without dividing by zero", () => {
  const { score, label } = computeDataQuality(modules({}));
  assert.equal(score, 0);
  assert.equal(label, "Poor");
});
