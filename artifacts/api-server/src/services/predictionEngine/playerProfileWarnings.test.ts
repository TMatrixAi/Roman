// Unit tests for Task #22's honest player-profile-resolution warnings: three distinct real
// states (live standings, historical-match fallback, genuinely unresolvable) must each produce
// their own distinct, non-silent warning text.
// Run with: pnpm --filter @workspace/api-server run test:predictionEngine
import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayerProfileWarnings } from "./playerProfileWarnings";
import type { PlayerProfile } from "../tennisData/types";

function makePlayer(overrides: Partial<PlayerProfile>): PlayerProfile {
  return {
    id: "p1",
    name: "Test Player",
    fullName: null,
    countryCode: null,
    currentRank: null,
    tour: "ATP",
    age: null,
    plays: null,
    source: "live-standings",
    ...overrides,
  };
}

test("buildPlayerProfileWarnings: both players resolved from live standings -> no warnings", () => {
  const warnings = buildPlayerProfileWarnings(makePlayer({ name: "A" }), makePlayer({ name: "B" }));
  assert.deepEqual(warnings, []);
});

test("buildPlayerProfileWarnings: historical-match fallback is disclosed, not silent", () => {
  const warnings = buildPlayerProfileWarnings(
    makePlayer({ name: "Challenger Player", tour: "Challenger", source: "historical-match" }),
    makePlayer({ name: "Standings Player" }),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Challenger Player/);
  assert.match(warnings[0], /current live ATP\/WTA standings/);
});

test("buildPlayerProfileWarnings: genuinely unresolvable tour is disclosed distinctly from the fallback case", () => {
  const warnings = buildPlayerProfileWarnings(
    makePlayer({ name: "Mystery Player", tour: null, source: undefined }),
    makePlayer({ name: "Standings Player" }),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Mystery Player/);
  assert.match(warnings[0], /could not be verified from live standings or any previously-fetched match record/);
});

test("buildPlayerProfileWarnings: both players need disclosure independently", () => {
  const warnings = buildPlayerProfileWarnings(
    makePlayer({ name: "Challenger Player", tour: "Challenger", source: "historical-match" }),
    makePlayer({ name: "Mystery Player", tour: null, source: undefined }),
  );
  assert.equal(warnings.length, 2);
});
