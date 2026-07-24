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
  assert.deepEqual(inferSurfaceAndLevel("2026 W15 Brisbane"), { surface: null, level: "ITF" });
});

test("Task #123: resolveSurfaceAndLevel resolves known fixed-venue indoor hard-court events via the reference list", () => {
  for (const name of ["Marseille", "Metz", "Sofia", "St. Petersburg", "Almaty", "Astana", "Tel Aviv", "Cologne"]) {
    const result = resolveSurfaceAndLevel({
      tournamentName: name,
      tournamentKey: "999999",
      eventTypeType: "Atp Singles",
      // Deliberately wrong in the key lookup to prove the reference list overrides an
      // unreliable/missing provider tag, exactly as it does for majors/Masters.
      surfaceByTournamentKey: new Map([["999999", "Hard"]]),
    });
    assert.equal(result.surface, "IndoorHard", `expected ${name} to resolve IndoorHard`);
  }
});

test("Task #123: WTA-only reference entries (Linz, Zurich) don't leak onto an ATP row at the same name", () => {
  for (const name of ["Linz", "Zurich"]) {
    const result = resolveSurfaceAndLevel({
      tournamentName: name,
      tournamentKey: "1",
      eventTypeType: "Atp Singles",
      surfaceByTournamentKey: new Map([["1", "Hard"]]),
    });
    // Falls through to the real tournament_key lookup instead of the WTA-only reference fact.
    assert.equal(result.surface, "Hard", `expected ${name} ATP row to fall through to the key lookup, not the WTA-only fact`);
  }
  const wtaResult = resolveSurfaceAndLevel({
    tournamentName: "Linz",
    tournamentKey: "1",
    eventTypeType: "Wta Singles",
    surfaceByTournamentKey: new Map([["1", "Hard"]]),
  });
  assert.equal(wtaResult.surface, "IndoorHard");
});

test("Task #123: a bare tournament name shared with a lower-tier ITF/Challenger event never matches the reference list, even without an ITF/Challenger marker in the name itself", () => {
  // Verified live (2026-07-14): API-Tennis returns some ITF rows with a completely bare city name
  // (no "ITF"/"M15"/"W25" prefix) -- only `event_type_type` says it's a lower tier. The name-only
  // NEVER_NAMED_TABLE guard can't catch this; resolveSurfaceAndLevel must use event_type_type too.
  const result = resolveSurfaceAndLevel({
    tournamentName: "Marseille",
    tournamentKey: "555",
    eventTypeType: "Itf Women Singles",
    surfaceByTournamentKey: new Map([["555", "Clay"]]),
  });
  assert.deepEqual(result, { surface: "Clay", level: "ITF" });
});
