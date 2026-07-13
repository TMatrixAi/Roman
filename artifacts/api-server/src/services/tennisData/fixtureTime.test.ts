import { test } from "node:test";
import assert from "node:assert/strict";
import { combineDateTimeUtc } from "./apiTennisProvider";
import { resolveTournamentTimezone } from "./timezoneMap";

/**
 * Guards the exact bug reported live: fixtures sharing a calendar date must resolve to their own
 * distinct real start times, never a single fabricated/shared time for the whole day.
 */
test("combineDateTimeUtc: different real per-fixture times on the same date produce different instants", () => {
  const a = combineDateTimeUtc("2026-07-12", "14:10", "UTC");
  const b = combineDateTimeUtc("2026-07-12", "16:10", "UTC");
  const c = combineDateTimeUtc("2026-07-12", "13:10", "UTC");

  assert.ok(a && b && c);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(b, c);

  // Same calendar date, but genuinely different instants two hours apart.
  assert.equal(new Date(b!).getTime() - new Date(a!).getTime(), 2 * 60 * 60 * 1000);
});

test("combineDateTimeUtc: a UTC venue combines date + time into the same UTC instant unshifted", () => {
  const result = combineDateTimeUtc("2026-07-12", "14:10", "UTC");
  assert.equal(result, "2026-07-12T14:10:00.000Z");
});

test("combineDateTimeUtc: returns null (never a guess) when the provider omits a real time", () => {
  assert.equal(combineDateTimeUtc("2026-07-12", undefined, "UTC"), null);
  assert.equal(combineDateTimeUtc("2026-07-12", "", "UTC"), null);
});

test("combineDateTimeUtc: returns null when the date is missing or malformed", () => {
  assert.equal(combineDateTimeUtc(undefined, "14:10", "UTC"), null);
  assert.equal(combineDateTimeUtc("not-a-date", "14:10", "UTC"), null);
});

test("combineDateTimeUtc: returns null for a malformed time string rather than misparsing it", () => {
  assert.equal(combineDateTimeUtc("2026-07-12", "2pm", "UTC"), null);
  assert.equal(combineDateTimeUtc("2026-07-12", "14", "UTC"), null);
});

test("combineDateTimeUtc: returns null (never a guess) when the venue's timezone couldn't be resolved", () => {
  assert.equal(combineDateTimeUtc("2026-07-12", "14:10", null), null);
});

// --- Real-venue offset regression tests: the original bug was treating event_time as if it were
// already UTC. These lock in the fix against the exact live evidence that found it (real UTC
// 2026-07-13T09:06Z, several matches already live/mid-set with raw event_time values that would
// be in the future if misread as UTC).

test("combineDateTimeUtc: a Romania fixture (Iasi, EEST = UTC+3 in July) converts local time to the correct earlier UTC instant", () => {
  const timezone = resolveTournamentTimezone("Iasi");
  assert.equal(timezone, "Europe/Bucharest");
  // Local 10:05 in EEST (UTC+3) is 07:05 UTC -- well before the real UTC time (09:06) the bug
  // report observed, consistent with this match already being live/mid-set at that moment.
  const result = combineDateTimeUtc("2026-07-13", "10:05", timezone);
  assert.equal(result, "2026-07-13T07:05:00.000Z");
});

test("combineDateTimeUtc: an Italy/Switzerland fixture (Rome/Gstaad, CEST = UTC+2 in July) converts correctly", () => {
  const rome = resolveTournamentTimezone("Rome");
  const gstaad = resolveTournamentTimezone("Gstaad");
  assert.equal(rome, "Europe/Rome");
  assert.equal(gstaad, "Europe/Zurich");
  // Local 10:40 CEST (UTC+2) is 08:40 UTC -- again before the real UTC time (09:06) observed live,
  // consistent with these matches already being underway.
  assert.equal(combineDateTimeUtc("2026-07-13", "10:40", rome), "2026-07-13T08:40:00.000Z");
  assert.equal(combineDateTimeUtc("2026-07-13", "10:40", gstaad), "2026-07-13T08:40:00.000Z");
});

test("combineDateTimeUtc: is DST-aware -- the same venue's offset differs between summer and winter", () => {
  const timezone = "Europe/Bucharest"; // EEST (+3) in July, EET (+2) in January
  const summer = combineDateTimeUtc("2026-07-13", "12:00", timezone);
  const winter = combineDateTimeUtc("2026-01-13", "12:00", timezone);
  assert.equal(summer, "2026-07-13T09:00:00.000Z");
  assert.equal(winter, "2026-01-13T10:00:00.000Z");
});

test("combineDateTimeUtc: a US venue (Lincoln, Central time) applies the correct multi-hour offset from UTC", () => {
  const timezone = resolveTournamentTimezone("Lincoln");
  assert.equal(timezone, "America/Chicago");
  // 18:00 CDT (UTC-5 in July) is 23:00 UTC the same day.
  assert.equal(combineDateTimeUtc("2026-07-13", "18:00", timezone), "2026-07-13T23:00:00.000Z");
});

test("resolveTournamentTimezone: resolves an explicit '(Country)' suffix for a single-timezone country", () => {
  assert.equal(resolveTournamentTimezone("Athens (Greece)"), "Europe/Athens");
  assert.equal(resolveTournamentTimezone("Athens (Greece) - Qualification"), "Europe/Athens");
  assert.equal(resolveTournamentTimezone("Istanbul 2 (Turkey)"), "Europe/Istanbul");
  assert.equal(resolveTournamentTimezone("Kitzbuhel (Austria) - Qualification"), "Europe/Vienna");
  assert.equal(resolveTournamentTimezone("M15 Villa Constitucion (Argentina)"), "America/Argentina/Buenos_Aires");
});

test("resolveTournamentTimezone: resolves known tour cities without a country suffix", () => {
  assert.equal(resolveTournamentTimezone("Iasi"), "Europe/Bucharest");
  assert.equal(resolveTournamentTimezone("W75 Granby"), "America/Toronto");
  assert.equal(resolveTournamentTimezone("Bastad"), "Europe/Stockholm");
  assert.equal(resolveTournamentTimezone("Umag"), "Europe/Zagreb");
});

test("resolveTournamentTimezone: a city match takes priority over a country suffix when both are present", () => {
  // Real fixture data never actually pairs Kitzbuhel with a conflicting city, but this proves the
  // city table is checked first, matching surfaceMap.ts's own precedence convention.
  assert.equal(resolveTournamentTimezone("Kitzbuhel (Austria)"), "Europe/Vienna");
});

test("resolveTournamentTimezone: never guesses for a multi-timezone country named without a resolvable city", () => {
  assert.equal(resolveTournamentTimezone("Some Open (United States)"), null);
  assert.equal(resolveTournamentTimezone("Some Open (Australia)"), null);
  assert.equal(resolveTournamentTimezone("Some Open (Canada)"), null);
});

test("resolveTournamentTimezone: returns null (never a guess) for an unrecognized tournament", () => {
  assert.equal(resolveTournamentTimezone("Billie Jean King Cup - Group III Teams"), null);
  assert.equal(resolveTournamentTimezone("UTS Championship"), null);
  assert.equal(resolveTournamentTimezone(null), null);
  assert.equal(resolveTournamentTimezone(undefined), null);
});
