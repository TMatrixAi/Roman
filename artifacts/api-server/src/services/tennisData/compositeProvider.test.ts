/**
 * Unit tests for CompositeTennisProvider routing behaviour.
 *
 * Key invariants:
 *  - getLiveScores() always uses the FALLBACK (API-Tennis), never the primary (MatchStat),
 *    because MatchStat returns an empty map unconditionally for this method.
 *  - getCompletedMatchesByDateRange() always uses the FALLBACK for the same reason.
 *  - Normal methods (searchPlayers, getPlayer, etc.) try primary first; ProviderUnavailableError
 *    on primary triggers fallback.
 *
 * Run with: pnpm --filter @workspace/api-server exec tsx --test src/services/tennisData/compositeProvider.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CompositeTennisProvider } from "./compositeProvider";
import { ProviderUnavailableError } from "./types";
import type {
  Fixture,
  HeadToHeadRecord,
  HistoricalFixture,
  LiveScore,
  MatchRecord,
  PlayerProfile,
  PlayerSummary,
  ProviderStatusInfo,
  TennisDataProvider,
} from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProvider(name: string, overrides: Partial<TennisDataProvider> = {}): TennisDataProvider & { calls: string[] } {
  const calls: string[] = [];
  const base: TennisDataProvider = {
    name,
    getStatus: (): ProviderStatusInfo => ({ provider: name, connected: true, lastSuccessfulCallAt: null, lastError: null }),
    searchPlayers: async (): Promise<PlayerSummary[]> => { calls.push(`${name}.searchPlayers`); return []; },
    getPlayer: async (): Promise<PlayerProfile | null> => { calls.push(`${name}.getPlayer`); return null; },
    getPlayerMatches: async (): Promise<MatchRecord[]> => { calls.push(`${name}.getPlayerMatches`); return []; },
    getUpcomingFixtures: async (): Promise<Fixture[]> => { calls.push(`${name}.getUpcomingFixtures`); return []; },
    getUpcomingFixturesRange: async (): Promise<Fixture[]> => { calls.push(`${name}.getUpcomingFixturesRange`); return []; },
    getHeadToHead: async (): Promise<HeadToHeadRecord> => { calls.push(`${name}.getHeadToHead`); return { player1Id: "a", player2Id: "b", meetings: [] }; },
    getCompletedMatchesByDateRange: async (): Promise<HistoricalFixture[]> => { calls.push(`${name}.getCompletedMatchesByDateRange`); return []; },
    getLiveScores: async (): Promise<Map<string, LiveScore>> => { calls.push(`${name}.getLiveScores`); return new Map(); },
  };
  return Object.assign({}, base, overrides, { calls });
}

// ─── getLiveScores routing ────────────────────────────────────────────────────

test("getLiveScores always routes to the FALLBACK, not the primary", async () => {
  const primary = makeProvider("MatchStat");
  const fallback = makeProvider("API-Tennis");
  const composite = new CompositeTennisProvider(primary, fallback);

  await composite.getLiveScores(["fixture-1"]);

  assert.equal(primary.calls.filter((c) => c.includes("getLiveScores")).length, 0,
    "Primary (MatchStat) must NOT be called for getLiveScores");
  assert.equal(fallback.calls.filter((c) => c.includes("getLiveScores")).length, 1,
    "Fallback (API-Tennis) MUST be called for getLiveScores");
});

test("getLiveScores returns real data from fallback even when primary is running fine", async () => {
  const liveScore: LiveScore = { sets: [{ player1Games: 3, player2Games: 2 }], statusText: "In progress" };
  const primary = makeProvider("MatchStat"); // would return empty map if called
  const fallback = makeProvider("API-Tennis", {
    getLiveScores: async (ids) => {
      const map = new Map<string, LiveScore>();
      for (const id of ids) map.set(id, liveScore);
      return map;
    },
  });
  const composite = new CompositeTennisProvider(primary, fallback);

  const result = await composite.getLiveScores(["fixture-1"]);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get("fixture-1"), liveScore);
});

// ─── getCompletedMatchesByDateRange routing ───────────────────────────────────

test("getCompletedMatchesByDateRange always routes to the FALLBACK", async () => {
  const primary = makeProvider("MatchStat");
  const fallback = makeProvider("API-Tennis");
  const composite = new CompositeTennisProvider(primary, fallback);

  await composite.getCompletedMatchesByDateRange("2026-01-01", "2026-01-07");

  assert.equal(primary.calls.filter((c) => c.includes("getCompletedMatchesByDateRange")).length, 0,
    "Primary must NOT be called for historical date-range backfill");
  assert.equal(fallback.calls.filter((c) => c.includes("getCompletedMatchesByDateRange")).length, 1,
    "Fallback MUST be called for historical date-range backfill");
});

// ─── Normal method fallback (ProviderUnavailableError) ───────────────────────

test("searchPlayers falls back to API-Tennis when primary throws ProviderUnavailableError", async () => {
  const primary = makeProvider("MatchStat", {
    searchPlayers: async () => { throw new ProviderUnavailableError("rate limited"); },
  });
  const fallback = makeProvider("API-Tennis", {
    searchPlayers: async () => [{ id: "p1", name: "Test Player", countryCode: null, currentRank: 1, tour: "ATP" }],
  });
  const composite = new CompositeTennisProvider(primary, fallback);

  const results = await composite.searchPlayers("test");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "p1");
});

test("searchPlayers does NOT fall back when primary succeeds (even with empty results)", async () => {
  const primary = makeProvider("MatchStat"); // returns [] successfully
  const fallback = makeProvider("API-Tennis");
  const composite = new CompositeTennisProvider(primary, fallback);

  await composite.searchPlayers("test");

  assert.equal(primary.calls.filter((c) => c.includes("searchPlayers")).length, 1, "Primary should be called");
  assert.equal(fallback.calls.filter((c) => c.includes("searchPlayers")).length, 0, "Fallback must NOT be called when primary succeeds");
});

test("non-ProviderUnavailableError from primary propagates without falling back", async () => {
  const primary = makeProvider("MatchStat", {
    searchPlayers: async () => { throw new TypeError("unexpected null"); },
  });
  const fallback = makeProvider("API-Tennis");
  const composite = new CompositeTennisProvider(primary, fallback);

  await assert.rejects(
    () => composite.searchPlayers("test"),
    (err) => err instanceof TypeError,
    "Non-ProviderUnavailableError must propagate, not trigger fallback",
  );
  assert.equal(fallback.calls.length, 0, "Fallback must not be called for non-ProviderUnavailableError");
});

// ─── getCurrentStandings routing ─────────────────────────────────────────────

test("getCurrentStandings always routes to the FALLBACK (API-Tennis), not the primary", async () => {
  const standings = [{ playerKey: "p1", rank: 1, name: "Player One", tour: "ATP" as const }];
  const primary = makeProvider("MatchStat");
  // Fallback implements getCurrentStandings (API-Tennis does; MatchStat does not).
  const fallback = makeProvider("API-Tennis", {
    getCurrentStandings: async () => { fallback.calls.push("API-Tennis.getCurrentStandings"); return standings; },
  });
  const composite = new CompositeTennisProvider(primary, fallback);

  const result = await composite.getCurrentStandings();

  assert.deepEqual(result, standings, "Should return the fallback standings unchanged");
  assert.equal(
    fallback.calls.filter((c) => c.includes("getCurrentStandings")).length,
    1,
    "Fallback getCurrentStandings must be called exactly once",
  );
  assert.equal(
    primary.calls.filter((c) => c.includes("getCurrentStandings")).length,
    0,
    "Primary must never be called for getCurrentStandings",
  );
});

test("getCurrentStandings returns an empty array gracefully when fallback does not implement it", async () => {
  const primary = makeProvider("MatchStat");
  const fallback = makeProvider("API-Tennis"); // no getCurrentStandings override
  const composite = new CompositeTennisProvider(primary, fallback);

  // Should not throw — returns [] so runRankingVerification logs the zero-standings sentinel.
  const result = await composite.getCurrentStandings();
  assert.deepEqual(result, [], "Should return empty array, not throw");
});
