import { test } from "node:test";
import assert from "node:assert/strict";
import { fitBestCalibration, isKnownBadCascadeRow, CASCADE_CUTOFF_DATE, type CalibrationPoint } from "./calibration";

/**
 * Task #128 regression test. A real production fold's validation data showed a local
 * non-monotonic dip: raw predictions around 60-65% only won ~51% of the time there, even though
 * both lower (54-58%) and higher (66-68%) neighboring raw bands won more often. A smooth Platt
 * sigmoid cannot represent that local dip -- it bridges over it -- and was winning the old
 * "lower average log loss" comparison anyway because the dip is confined to one narrow band and
 * log loss averages over every point, not every band. This synthesizes a distribution with the
 * same shape (monotonic overall, with one localized dip) and asserts isotonic wins, and that the
 * winning mapping is not overconfident in the dip's band.
 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function trueWinProbability(raw: number): number {
  // Monotonic overall (0.30 -> 0.85), except a real local dip carved out of the 0.60-0.65 band.
  if (raw >= 0.6 && raw < 0.65) return 0.51;
  return 0.3 + raw * 0.65;
}

function buildDipDataset(n: number, seed: number): CalibrationPoint[] {
  const rand = seededRandom(seed);
  const points: CalibrationPoint[] = [];
  for (let i = 0; i < n; i++) {
    const raw = 0.3 + rand() * 0.5; // spans 0.30-0.80, covering the dip band
    const p = trueWinProbability(raw);
    points.push({ rawProbability: raw, outcome: rand() < p ? 1 : 0 });
  }
  return points;
}

function buildSmoothDataset(n: number, seed: number): CalibrationPoint[] {
  const rand = seededRandom(seed);
  const points: CalibrationPoint[] = [];
  for (let i = 0; i < n; i++) {
    const raw = 0.05 + rand() * 0.9;
    // A genuinely smooth, purely sigmoid-shaped relationship with no local violations --
    // Platt's own functional form, so it should win outright here.
    const logit = 2.5 * Math.log(raw / (1 - raw));
    const p = 1 / (1 + Math.exp(-logit));
    points.push({ rawProbability: raw, outcome: rand() < p ? 1 : 0 });
  }
  return points;
}

test("fitBestCalibration prefers isotonic over Platt when Platt bridges over a real local dip (Task #128)", () => {
  const points = buildDipDataset(2400, 42);
  const result = fitBestCalibration(points);

  assert.equal(result.method, "isotonic", "Platt's smooth sigmoid should lose once its holdout ECE is worse than isotonic's in the dip band");
  assert.ok(result.isotonicHoldoutEce !== null && result.plattHoldoutEce !== null, "both holdout ECEs should be computed when there's a holdout slice");
  assert.ok(
    (result.isotonicHoldoutEce as number) <= (result.plattHoldoutEce as number) + 1e-9,
    "isotonic must not be reported as the worse-calibrated method when it won",
  );
});

test("fitBestCalibration still lets Platt win when it genuinely beats isotonic on both log loss and calibration", () => {
  const points = buildSmoothDataset(300, 9);
  const result = fitBestCalibration(points);

  assert.equal(result.method, "platt", "a genuine, uncontested Platt win on both log loss and ECE should not be blocked by the ECE guard");
});

test("fitBestCalibration returns null holdout metrics (never guesses) when there isn't enough data for a holdout slice", () => {
  const points: CalibrationPoint[] = Array.from({ length: 10 }, (_, i) => ({
    rawProbability: 0.4 + i * 0.02,
    outcome: i % 2 === 0 ? 1 : 0,
  }));
  const result = fitBestCalibration(points);

  assert.equal(result.method, "isotonic");
  assert.equal(result.holdoutSampleSize, 0);
  assert.equal(result.isotonicHoldoutEce, null);
  assert.equal(result.plattHoldoutEce, null);
});

// ── Task #55: isKnownBadCascadeRow unit tests ─────────────────────────────────
// These tests confirm the cascade-exclusion filter correctly identifies rows
// scored by the old directional tie-break cascade (removed 2026-07-15).

const BEFORE_CUTOFF = new Date(CASCADE_CUTOFF_DATE.getTime() - 24 * 60 * 60 * 1000);
const AT_CUTOFF = CASCADE_CUTOFF_DATE;
const AFTER_CUTOFF = new Date(CASCADE_CUTOFF_DATE.getTime() + 24 * 60 * 60 * 1000);

test("isKnownBadCascadeRow — cutoff date is 2026-07-15T00:00:00.000Z", () => {
  assert.equal(CASCADE_CUTOFF_DATE.toISOString(), "2026-07-15T00:00:00.000Z");
});

test("isKnownBadCascadeRow — rows locked AT or AFTER the cutoff are always clean, regardless of tieBreakerApplied flag", () => {
  // Any row written by the current engine (post-cutoff) is by definition clean.
  assert.equal(isKnownBadCascadeRow(AT_CUTOFF, true), false, "AT cutoff with tieBreakerApplied:true must be clean");
  assert.equal(isKnownBadCascadeRow(AT_CUTOFF, false), false, "AT cutoff with tieBreakerApplied:false must be clean");
  assert.equal(isKnownBadCascadeRow(AFTER_CUTOFF, true), false, "AFTER cutoff with tieBreakerApplied:true must be clean");
  assert.equal(isKnownBadCascadeRow(AFTER_CUTOFF, false), false, "AFTER cutoff with tieBreakerApplied:false must be clean");
  assert.equal(
    isKnownBadCascadeRow(AFTER_CUTOFF, { engine: { tieBreakerApplied: true } }),
    false,
    "AFTER cutoff with full snapshot tieBreakerApplied:true must be clean",
  );
});

test("isKnownBadCascadeRow — boolean shorthand: true identifies a bad row, false identifies a clean row (pre-cutoff)", () => {
  assert.equal(isKnownBadCascadeRow(BEFORE_CUTOFF, true), true, "pre-cutoff + tieBreakerApplied=true must be flagged as bad");
  assert.equal(isKnownBadCascadeRow(BEFORE_CUTOFF, false), false, "pre-cutoff + tieBreakerApplied=false must be clean");
});

test("isKnownBadCascadeRow — full featureSnapshot: correctly inspects engine.tieBreakerApplied", () => {
  assert.equal(
    isKnownBadCascadeRow(BEFORE_CUTOFF, { engine: { tieBreakerApplied: true } }),
    true,
    "pre-cutoff snapshot with tieBreakerApplied:true must be flagged",
  );
  assert.equal(
    isKnownBadCascadeRow(BEFORE_CUTOFF, { engine: { tieBreakerApplied: false } }),
    false,
    "pre-cutoff snapshot with tieBreakerApplied:false must be clean",
  );
  assert.equal(
    isKnownBadCascadeRow(BEFORE_CUTOFF, { engine: {} }),
    false,
    "pre-cutoff snapshot with engine but no tieBreakerApplied field must be clean",
  );
  assert.equal(isKnownBadCascadeRow(BEFORE_CUTOFF, {}), false, "pre-cutoff snapshot with no engine key must be clean");
});

test("isKnownBadCascadeRow — null / non-object featureSnapshot: treated as clean (never crashes)", () => {
  assert.equal(isKnownBadCascadeRow(BEFORE_CUTOFF, null), false, "null snapshot before cutoff must be clean");
  assert.equal(isKnownBadCascadeRow(BEFORE_CUTOFF, undefined), false, "undefined snapshot before cutoff must be clean");
  assert.equal(isKnownBadCascadeRow(BEFORE_CUTOFF, "bad-cascade"), false, "string value before cutoff must be clean");
  assert.equal(isKnownBadCascadeRow(BEFORE_CUTOFF, 1), false, "numeric value before cutoff must be clean");
});

test("isKnownBadCascadeRow — calibration training path: contaminated rows are excluded, clean rows pass through", () => {
  // Simulates exactly what walkForward.ts does for fold calibration training:
  //   foldEligible.filter((r) => !isKnownBadCascadeRow(r.lockedAt, r.tieBreakerApplied))
  const foldRows = [
    { id: 1, lockedAt: BEFORE_CUTOFF, tieBreakerApplied: true, rawProbability: 0.7, includedInAccuracy: true },
    { id: 2, lockedAt: BEFORE_CUTOFF, tieBreakerApplied: false, rawProbability: 0.6, includedInAccuracy: true },
    { id: 3, lockedAt: AFTER_CUTOFF, tieBreakerApplied: true, rawProbability: 0.55, includedInAccuracy: true },
    { id: 4, lockedAt: AFTER_CUTOFF, tieBreakerApplied: false, rawProbability: 0.65, includedInAccuracy: true },
  ];
  const trainingPoints = foldRows.filter((r) => !isKnownBadCascadeRow(r.lockedAt, r.tieBreakerApplied));
  assert.equal(trainingPoints.length, 3, "Only the pre-cutoff + tieBreakerApplied=true row must be excluded");
  assert.ok(
    !trainingPoints.some((r) => r.id === 1),
    "Row 1 (pre-cutoff, tieBreakerApplied:true) must be excluded from calibration training",
  );
  assert.ok(
    trainingPoints.some((r) => r.id === 2),
    "Row 2 (pre-cutoff, tieBreakerApplied:false) must NOT be excluded — it was scored cleanly",
  );
  assert.ok(
    trainingPoints.some((r) => r.id === 3),
    "Row 3 (post-cutoff, tieBreakerApplied:true) must NOT be excluded — post-cutoff rows are always clean",
  );
  assert.ok(
    trainingPoints.some((r) => r.id === 4),
    "Row 4 (post-cutoff, tieBreakerApplied:false) must NOT be excluded",
  );
});
