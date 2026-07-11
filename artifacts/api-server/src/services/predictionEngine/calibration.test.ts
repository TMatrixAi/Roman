import test from "node:test";
import assert from "node:assert/strict";
import { calibrateProbability } from "./calibration";

test("does not shrink at all once data quality reaches the Strong threshold (65)", () => {
  assert.equal(calibrateProbability(65, 65), 65);
  assert.equal(calibrateProbability(65, 90), 65);
});

test("shrinks moderately, not severely, at typical 'Acceptable' data quality (48-63)", () => {
  // Previously (dataQuality/90 divisor) these were compressed by 0.53-0.70; real walk-forward
  // outcomes showed real signal even in noisier-than-typical data, so the new curve keeps more
  // of the raw edge here.
  const at48 = calibrateProbability(65, 48);
  const at63 = calibrateProbability(65, 63);
  assert.ok(at48 > 58, `expected meaningfully above midpoint-shrunk value at DQ=48, got ${at48}`);
  assert.ok(at63 > 62, `expected close to full trust at DQ=63, got ${at63}`);
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
