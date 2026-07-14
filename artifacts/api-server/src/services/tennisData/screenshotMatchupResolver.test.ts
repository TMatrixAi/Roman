// Unit tests for the screenshot-import surface fallback: a screenshot only ever has OCR'd event
// text, never a real tournament_key, so Challenger/ITF events (deliberately excluded from the
// name-only regex table -- see surfaceMap.ts) must fall back to a real name search against the
// provider's own tournament data instead of being left surface-less every time.
// Run with: pnpm --filter @workspace/api-server run test:tennisData
import test from "node:test";
import assert from "node:assert/strict";
import { resolveScreenshotMatchup } from "./screenshotMatchupResolver";
import type { PlayerSummary, TennisDataProvider } from "./types";

function makeProvider(overrides: Partial<TennisDataProvider> = {}): TennisDataProvider {
  return {
    name: "fake",
    getStatus: () => ({ provider: "fake", connected: true, lastSuccessfulCallAt: null, lastError: null }),
    searchPlayers: async (): Promise<PlayerSummary[]> => [],
    getPlayer: async () => null,
    getPlayerMatches: async () => [],
    getUpcomingFixtures: async () => [],
    getUpcomingFixturesRange: async () => [],
    getHeadToHead: async (player1Id: string, player2Id: string) => ({ player1Id, player2Id, meetings: [] }),
    getCompletedMatchesByDateRange: async () => [],
    ...overrides,
  };
}

test("resolveScreenshotMatchup falls back to a real name search for a Challenger event the name table never covers", async () => {
  const provider = makeProvider({
    findTournamentSurfaceByName: async (name: string) => {
      assert.equal(name, "ATP Challenger Pozoblanco");
      return { surface: "Clay", level: "Challenger" };
    },
  });

  const result = await resolveScreenshotMatchup(provider, {
    player1Name: null,
    player2Name: null,
    eventName: "ATP Challenger Pozoblanco",
  });

  assert.equal(result.event.surface, "Clay");
  assert.equal(result.event.level, "Challenger");
  assert.ok(!result.warnings.some((w) => w.includes("couldn't determine its surface")));
});

test("resolveScreenshotMatchup still warns when the name-search fallback also finds nothing", async () => {
  const provider = makeProvider({
    findTournamentSurfaceByName: async () => null,
  });

  const result = await resolveScreenshotMatchup(provider, {
    player1Name: null,
    player2Name: null,
    eventName: "Some Untraceable Regional Event",
  });

  assert.equal(result.event.surface, null);
  assert.ok(result.warnings.some((w) => w.includes("couldn't determine its surface")));
});

test("resolveScreenshotMatchup never calls the name-search fallback when a provider doesn't implement it", async () => {
  const provider = makeProvider(); // no findTournamentSurfaceByName at all

  const result = await resolveScreenshotMatchup(provider, {
    player1Name: null,
    player2Name: null,
    eventName: "ATP Challenger Pozoblanco",
  });

  assert.equal(result.event.surface, null);
  assert.ok(result.warnings.some((w) => w.includes("couldn't determine its surface")));
});

test("resolveScreenshotMatchup prefers the precise named table over the name-search fallback for a major", async () => {
  const provider = makeProvider({
    findTournamentSurfaceByName: async () => {
      throw new Error("should never be called -- Wimbledon already resolves via the named table");
    },
  });

  const result = await resolveScreenshotMatchup(provider, {
    player1Name: null,
    player2Name: null,
    eventName: "Wimbledon",
  });

  assert.equal(result.event.surface, "Grass");
  assert.equal(result.event.level, "GrandSlam");
});
