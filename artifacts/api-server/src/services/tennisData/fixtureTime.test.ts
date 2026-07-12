import { test } from "node:test";
import assert from "node:assert/strict";
import { combineDateTimeUtc } from "./apiTennisProvider";

/**
 * Guards the exact bug reported live: fixtures sharing a calendar date must resolve to their own
 * distinct real start times, never a single fabricated/shared time for the whole day.
 */
test("combineDateTimeUtc: different real per-fixture times on the same date produce different instants", () => {
  const a = combineDateTimeUtc("2026-07-12", "14:10");
  const b = combineDateTimeUtc("2026-07-12", "16:10");
  const c = combineDateTimeUtc("2026-07-12", "13:10");

  assert.ok(a && b && c);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(b, c);

  // Same calendar date, but genuinely different instants two hours apart.
  assert.equal(new Date(b!).getTime() - new Date(a!).getTime(), 2 * 60 * 60 * 1000);
});

test("combineDateTimeUtc: combines date + time into the correct UTC instant", () => {
  const result = combineDateTimeUtc("2026-07-12", "14:10");
  assert.equal(result, "2026-07-12T14:10:00.000Z");
});

test("combineDateTimeUtc: returns null (never a guess) when the provider omits a real time", () => {
  assert.equal(combineDateTimeUtc("2026-07-12", undefined), null);
  assert.equal(combineDateTimeUtc("2026-07-12", ""), null);
});

test("combineDateTimeUtc: returns null when the date is missing or malformed", () => {
  assert.equal(combineDateTimeUtc(undefined, "14:10"), null);
  assert.equal(combineDateTimeUtc("not-a-date", "14:10"), null);
});

test("combineDateTimeUtc: returns null for a malformed time string rather than misparsing it", () => {
  assert.equal(combineDateTimeUtc("2026-07-12", "2pm"), null);
  assert.equal(combineDateTimeUtc("2026-07-12", "14"), null);
});
