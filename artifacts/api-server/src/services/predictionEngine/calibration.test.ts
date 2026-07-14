import test from "node:test";
import assert from "node:assert/strict";
import { calibrateProbability } from "./calibration";

test("caps the confidence factor at 0.85 once data quality reaches 55, never claiming full raw trust (Task #75 re-validation)", () => {
  // factor = min(0.85, (dq-20)/35), reaches its 0.85 cap at dq=55 and stays there for any higher dq.
  const at55 = calibrateProbability(65, 55);
  const at65 = calibrateProbability(65, 65);
  const at90 = calibrateProbability(65, 90);
  assert.equal(at55, at65);
  assert.equal(at65, at90);
  assert.ok(at55 < 65, `expected some residual shrinkage even at high data quality, got ${at55}`);
  assert.equal(at55, 62.8); // 50 + (65-50)*0.85 = 62.75, rounded to 1 decimal
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
