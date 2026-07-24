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
    getLiveScores: async () => new Map(),
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
    matchups: [{ player1Name: null, player2Name: null, eventName: "ATP Challenger Pozoblanco" }],
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
    matchups: [{ player1Name: null, player2Name: null, eventName: "Some Untraceable Regional Event" }],
  });

  assert.equal(result.event.surface, null);
  assert.ok(result.warnings.some((w) => w.includes("couldn't determine its surface")));
});

test("resolveScreenshotMatchup never calls the name-search fallback when a provider doesn't implement it", async () => {
  const provider = makeProvider(); // no findTournamentSurfaceByName at all

  const result = await resolveScreenshotMatchup(provider, {
    matchups: [{ player1Name: null, player2Name: null, eventName: "ATP Challenger Pozoblanco" }],
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
    matchups: [{ player1Name: null, player2Name: null, eventName: "Wimbledon" }],
  });

  assert.equal(result.event.surface, "Grass");
  assert.equal(result.event.level, "GrandSlam");
});

test("resolveScreenshotMatchup returns matchups array with multiple entries when input has multiple", async () => {
  // Use clearly fictional names ("Testington", "Fakeovsky") that cannot appear in the real
  // historical_matches DB rows — avoids the mock-id vs DB-id duplicate that trips isConfidentMatch.
  const provider = makeProvider({
    searchPlayers: async (query: string) => {
      if (query.toLowerCase().includes("testington"))
        return [{ id: "test-1", name: "John Testington", countryCode: "TST", currentRank: 99, tour: "ATP" }];
      if (query.toLowerCase().includes("fakeovsky"))
        return [{ id: "fake-1", name: "Ivan Fakeovsky", countryCode: "FAK", currentRank: 98, tour: "ATP" }];
      if (query.toLowerCase().includes("mockerson"))
        return [{ id: "mock-1", name: "Dave Mockerson", countryCode: "MCK", currentRank: 97, tour: "ATP" }];
      if (query.toLowerCase().includes("stubsworth"))
        return [{ id: "stub-1", name: "Carl Stubsworth", countryCode: "STB", currentRank: 96, tour: "ATP" }];
      return [];
    },
  });

  const result = await resolveScreenshotMatchup(provider, {
    matchups: [
      { player1Name: "Testington", player2Name: "Fakeovsky", eventName: null },
      { player1Name: "Mockerson", player2Name: "Stubsworth", eventName: null },
    ],
  });

  assert.ok(result.matchups, "matchups array present");
  assert.equal(result.matchups!.length, 2);
  assert.equal(result.matchups![0].player1.player?.id, "test-1");
  assert.equal(result.matchups![0].player2.player?.id, "fake-1");
  assert.equal(result.matchups![1].player1.player?.id, "mock-1");
  assert.equal(result.matchups![1].player2.player?.id, "stub-1");
  assert.ok(result.matchups![0].resolved);
  assert.ok(result.matchups![1].resolved);
});

test("resolveScreenshotMatchup prefers an exact full-name match over abbreviated lookalikes", async () => {
  const provider = makeProvider({
    searchPlayers: async (query: string) => {
      const q = query.toLowerCase();
      if (q.includes("maiko") || q.includes("uchijima")) {
        return [
          { id: "abbr-a", name: "M. Uchijima", countryCode: "JP", currentRank: null, tour: "WTA" },
          { id: "maiko-id", name: "Maiko Uchijima", countryCode: "JP", currentRank: 120, tour: "WTA" },
        ];
      }
      if (q.includes("arakawa")) {
        return [{ id: "arakawa-id", name: "Natsuho Arakawa", countryCode: "JP", currentRank: 250, tour: "WTA" }];
      }
      return [];
    },
  });

  const result = await resolveScreenshotMatchup(provider, {
    matchups: [{ player1Name: "Natsuho Arakawa", player2Name: "Maiko Uchijima", eventName: "2026 W15 Brisbane Quarterfinal" }],
  });

  assert.equal(result.player1.player?.id, "arakawa-id");
  assert.equal(result.player2.player?.id, "maiko-id");
  assert.ok(result.warnings.every((w) => !w.includes("multiple matching players")));
});

test("resolveScreenshotMatchup does not silently guess between multiple full-name candidates sharing one abbreviation", async () => {
  const provider = makeProvider({
    searchPlayers: async (query: string) => {
      const q = query.toLowerCase();
      if (q.includes("uchijima")) {
        return [
          { id: "moyuka-id", name: "Moyuka Uchijima", countryCode: "JP", currentRank: 55, tour: "WTA" },
          { id: "maiko-id", name: "Maiko Uchijima", countryCode: "JP", currentRank: 120, tour: "WTA" },
        ];
      }
      if (q.includes("arakawa")) {
        return [{ id: "arakawa-id", name: "Natsuho Arakawa", countryCode: "JP", currentRank: 250, tour: "WTA" }];
      }
      return [];
    },
  });

  const result = await resolveScreenshotMatchup(provider, {
    matchups: [{ player1Name: "Natsuho Arakawa", player2Name: "M. Uchijima", eventName: "2026 W15 Brisbane Quarterfinal" }],
  });

  assert.equal(result.player1.player?.id, "arakawa-id");
  assert.equal(result.player2.player, null);
  assert.ok(result.warnings.some((w) => w.includes("multiple matching players")));
});

test("resolveScreenshotMatchup resolves a unique scheduled fixture from fuzzy OCR name variants", async () => {
  const provider = makeProvider({
    searchPlayers: async (query: string) => {
      const q = query.toLowerCase();
      if (q.includes("arakawa")) {
        return [{ id: "arakawa-id", name: "Natsuho Arakawa", countryCode: "JP", currentRank: 250, tour: "WTA" }];
      }
      // Simulate OCR-parsed Uchijima path not returning a direct player hit from name search.
      if (q.includes("uchijima") || q.includes("uchijlma")) {
        return [];
      }
      return [];
    },
    getUpcomingFixtures: async () => [{
      id: "fx-1",
      date: "2026-07-24",
      scheduledStart: null,
      timeConfirmed: false,
      isLive: false,
      tournamentName: "W15 Brisbane",
      tournamentLevel: "ITF",
      round: "Quarter-Final",
      surface: "Hard",
      indoor: false,
      matchFormat: "BestOf3",
      player1Id: "arakawa-id",
      player1Name: "Natsuho Arakawa",
      player2Id: "maiko-id",
      player2Name: "Maiko Uchijima",
    }],
  });

  const result = await resolveScreenshotMatchup(provider, {
    matchups: [{ player1Name: "Natsuho Arakawa", player2Name: "Maiko Uchijlma", eventName: "W15 Brisbane Quarterfinal" }],
  });

  assert.equal(result.player1.player?.id, "arakawa-id");
  assert.equal(result.player2.player?.id, "maiko-id");
  assert.ok(result.warnings.some((w) => w.includes("[resolver-debug] Resolved via fixture-")));
  assert.ok(result.warnings.every((w) => !w.includes("couldn't confidently match") || !w.includes("Player 2")));
});

test("resolveScreenshotMatchup infers the unresolved opponent when one player is confidently matched and one unique fixture fits", async () => {
  const provider = makeProvider({
    searchPlayers: async (query: string) => {
      const q = query.toLowerCase();
      if (q.includes("arakawa")) {
        return [{ id: "arakawa-id", name: "Natsuho Arakawa", countryCode: "JP", currentRank: 250, tour: "WTA" }];
      }
      return [];
    },
    getUpcomingFixtures: async () => [{
      id: "fx-2",
      date: "2026-07-24",
      scheduledStart: null,
      timeConfirmed: false,
      isLive: false,
      tournamentName: "W15 Brisbane",
      tournamentLevel: "ITF",
      round: "Quarter-Final",
      surface: "Hard",
      indoor: false,
      matchFormat: "BestOf3",
      player1Id: "arakawa-id",
      player1Name: "Natsuho Arakawa",
      player2Id: "maiko-id",
      player2Name: "Maiko Uchijima",
    }],
  });

  const result = await resolveScreenshotMatchup(provider, {
    matchups: [{ player1Name: "Natsuho Arakawa", player2Name: "M. Uchijlma", eventName: "W15 Brisbane Quarterfinal" }],
  });

  assert.equal(result.player1.player?.id, "arakawa-id");
  assert.equal(result.player2.player?.id, "maiko-id");
  assert.ok(result.warnings.some((w) => w.includes("[resolver-debug] Resolved via fixture-opponent-inference-from-player1")));
});

test("resolveScreenshotMatchup keeps entry unresolved when multiple scheduled fixtures remain ambiguous", async () => {
  const provider = makeProvider({
    searchPlayers: async (query: string) => {
      const q = query.toLowerCase();
      if (q.includes("arakawa")) {
        return [{ id: "arakawa-id", name: "Natsuho Arakawa", countryCode: "JP", currentRank: 250, tour: "WTA" }];
      }
      return [];
    },
    getUpcomingFixtures: async () => [
      {
        id: "fx-3",
        date: "2026-07-24",
        scheduledStart: null,
        timeConfirmed: false,
        isLive: false,
        tournamentName: "W15 Brisbane",
        tournamentLevel: "ITF",
        round: "Quarter-Final",
        surface: "Hard",
        indoor: false,
        matchFormat: "BestOf3",
        player1Id: "arakawa-id",
        player1Name: "Natsuho Arakawa",
        player2Id: "maiko-id",
        player2Name: "Maiko Uchijima",
      },
      {
        id: "fx-4",
        date: "2026-07-24",
        scheduledStart: null,
        timeConfirmed: false,
        isLive: false,
        tournamentName: "W15 Brisbane",
        tournamentLevel: "ITF",
        round: "Quarter-Final",
        surface: "Hard",
        indoor: false,
        matchFormat: "BestOf3",
        player1Id: "arakawa-id",
        player1Name: "Natsuho Arakawa",
        player2Id: "moyuka-id",
        player2Name: "Moyuka Uchijima",
      },
    ],
  });

  const result = await resolveScreenshotMatchup(provider, {
    matchups: [{ player1Name: "Natsuho Arakawa", player2Name: "M. Uchijima", eventName: "W15 Brisbane Quarterfinal" }],
  });

  assert.equal(result.player1.player?.id, "arakawa-id");
  assert.equal(result.player2.player, null);
  assert.ok(result.warnings.some((w) => w.includes("couldn't confidently match") && w.includes("Player 2")));
  assert.ok(result.warnings.every((w) => !w.includes("[resolver-debug] Resolved via")));
});
