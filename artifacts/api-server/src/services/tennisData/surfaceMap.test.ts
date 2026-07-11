import assert from "node:assert/strict";
import { test } from "node:test";
import { inferLevelFromEventType, inferSurfaceAndLevel, normalizeProviderSurface, resolveSurfaceAndLevel } from "./surfaceMap";

test("normalizeProviderSurface handles real provider variants", () => {
  assert.equal(normalizeProviderSurface("Hard"), "Hard");
  assert.equal(normalizeProviderSurface("hard"), "Hard");
  assert.equal(normalizeProviderSurface("Hard (Indoor)"), "IndoorHard");
  assert.equal(normalizeProviderSurface("Clay"), "Clay");
  assert.equal(normalizeProviderSurface("clay"), "Clay");
  assert.equal(normalizeProviderSurface("Clay (Indoor)"), "Clay");
  assert.equal(normalizeProviderSurface("Grass"), "Grass");
  assert.equal(normalizeProviderSurface("Grass (Indoor)"), "Grass");
});

test("normalizeProviderSurface rejects junk/non-surface values instead of guessing", () => {
  assert.equal(normalizeProviderSurface(""), null);
  assert.equal(normalizeProviderSurface(null), null);
  assert.equal(normalizeProviderSurface(undefined), null);
  assert.equal(normalizeProviderSurface("- Promotion"), null);
  assert.equal(normalizeProviderSurface("- Play Offs"), null);
});

test("inferLevelFromEventType classifies known provider event-type labels", () => {
  assert.equal(inferLevelFromEventType("Challenger Men Singles"), "Challenger");
  assert.equal(inferLevelFromEventType("Itf Women Doubles"), "ITF");
  assert.equal(inferLevelFromEventType("Atp Singles"), "ATP250");
  assert.equal(inferLevelFromEventType("Wta Singles"), "WTA250");
  assert.equal(inferLevelFromEventType("Boys Singles"), "Other");
  assert.equal(inferLevelFromEventType("Exhibition Men"), "Other");
  assert.equal(inferLevelFromEventType(""), null);
  assert.equal(inferLevelFromEventType(null), null);
});

test("resolveSurfaceAndLevel prefers the precise named table for majors/Masters over the key lookup", () => {
  const result = resolveSurfaceAndLevel({
    tournamentName: "Wimbledon",
    tournamentKey: "999",
    eventTypeType: "Atp Singles",
    // Deliberately wrong in the lookup, to prove the named table wins for known majors.
    surfaceByTournamentKey: new Map([["999", "Hard"]]),
  });
  assert.deepEqual(result, { surface: "Grass", level: "GrandSlam" });
});

test("resolveSurfaceAndLevel uses the real tournament_key lookup for Challenger/ITF events the named table doesn't cover", () => {
  const result = resolveSurfaceAndLevel({
    tournamentName: "Aachen Challenger",
    tournamentKey: "2833",
    eventTypeType: "Challenger Men Singles",
    surfaceByTournamentKey: new Map([["2833", "Hard"]]),
  });
  assert.deepEqual(result, { surface: "Hard", level: "Challenger" });
});

test("resolveSurfaceAndLevel returns null surface (never a guess) when neither source has real data", () => {
  const result = resolveSurfaceAndLevel({
    tournamentName: "Some Obscure Event",
    tournamentKey: "424242",
    eventTypeType: "Boys Singles",
    surfaceByTournamentKey: new Map(),
  });
  assert.deepEqual(result, { surface: null, level: "Other" });
});

test("resolveSurfaceAndLevel falls back to the null-safe key lookup entry (explicit unresolved surface) without crashing", () => {
  const result = resolveSurfaceAndLevel({
    tournamentName: "Team Event",
    tournamentKey: "111",
    eventTypeType: "Teams Men",
    surfaceByTournamentKey: new Map([["111", null]]),
  });
  assert.deepEqual(result, { surface: null, level: "Other" });
});

test("legacy inferSurfaceAndLevel still resolves the named majors/Masters table on its own", () => {
  assert.deepEqual(inferSurfaceAndLevel("Miami Open"), { surface: "Hard", level: "Masters1000" });
  assert.deepEqual(inferSurfaceAndLevel("Some Challenger Event"), { surface: null, level: null });
});
