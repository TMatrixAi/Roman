import test from "node:test";
import assert from "node:assert/strict";
import { calibrateProbability } from "./calibration";

test("caps the confidence factor at 0.8 for the genuinely-supported 55-65 band, never claiming full raw trust (Task #75 re-validation)", () => {
  const at55 = calibrateProbability(65, 55);
  const at65 = calibrateProbability(65, 65);
  assert.equal(at55, at65);
  assert.ok(at55 < 65, `expected some residual shrinkage even at high data quality, got ${at55}`);
  assert.equal(at55, 62); // 50 + (65-50)*0.8 = 62.0
});

test("decays trust back down past data quality 65, instead of holding a flat cap (Task #151 re-validation)", () => {
  // The 2026-07-13 ablation report found real accuracy keeps getting WORSE past DQ 65 (56.0% for
  // DQ>=65 vs 57.6% below it, n=13,066), so a flat cap across all of 55-100 still over-trusts the
  // top of the range -- the curve should keep decaying, all the way back down to the same 0.4
  // floor thin data gets, by DQ 100.
  const at65 = calibrateProbability(65, 65);
  const at85 = calibrateProbability(65, 85);
  const at100 = calibrateProbability(65, 100);
  assert.ok(at85 < at65, `expected less trust at DQ=85 than DQ=65, got ${at85} vs ${at65}`);
  assert.ok(at100 < at85, `expected less trust at DQ=100 than DQ=85, got ${at100} vs ${at85}`);
  assert.equal(at100, 56); // floor factor 0.4 -> 50 + (65-50)*0.4 = 56, same floor as thin data
});

test("shrinks moderately, not severely, at typical 'Acceptable' data quality (48-63)", () => {
  // Previously (dataQuality/90 divisor) these were compressed by 0.53-0.70; real walk-forward
  // outcomes showed real signal even in noisier-than-typical data, so the new curve keeps more
  // of the raw edge here.
  const at48 = calibrateProbability(65, 48);
  const at63 = calibrateProbability(65, 63);
  assert.ok(at48 > 58, `expected meaningfully above midpoint-shrunk value at DQ=48, got ${at48}`);
  assert.ok(at63 > 61.5, `expected close to full trust at DQ=63, got ${at63}`);
});

test("still shrinks hard toward 50 for genuinely thin (Poor) data quality", () => {
  const at10 = calibrateProbability(80, 10);
  // floor is 0.4 -> 50 + (80-50)*0.4 = 62
  assert.equal(at10, 62);
});

test("never extrapolates outside the [5, 95] safety clamp", () => {
  assert.ok(calibrateProbability(99, 100) <= 95);
  assert.ok(calibrateProbability(1, 100) >= 5);
});

test("is a no-op at exactly 50% raw probability regardless of data quality", () => {
  assert.equal(calibrateProbability(50, 10), 50);
  assert.equal(calibrateProbability(50, 90), 50);
});
