// Unit tests for Task #22's real cross-source player identity resolution: a player outside the
// live standings feed but present in our own previously-fetched historical match records should
// still resolve (via searchKnownPlayers and resolvePlayerProfile), honestly labeled
// source: "historical-match", never silently dropped and never fabricated.
// Run with: pnpm --filter @workspace/api-server run test:tennisData
import test from "node:test";
import assert from "node:assert/strict";
import { db, historicalMatchesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { clearCountryCodeCacheForTests, resolvePlayerProfile, searchKnownPlayers } from "./playerIdentity";
import type { PlayerProfile, PlayerSummary, TennisDataProvider } from "./types";

const PROVIDER = "player-identity-test";
const CHALLENGER_ONLY_ID = "pid-test-challenger-001";
const CHALLENGER_ONLY_NAME = "Zzqtest Challengerplayer";
const NEVER_SEEN_ID = "pid-test-never-seen-999";

function makeMatch(player1Id: string, player1Name: string) {
  const scheduledStartAt = new Date(Date.UTC(2024, 5, 1, 12, 0, 0));
  return {
    externalId: `${PROVIDER}-${player1Id}`,
    provider: PROVIDER,
    tour: "Challenger",
    tournamentName: "Player Identity Test Series",
    tournamentLevel: null,
    surface: "Hard" as const,
    round: null,
    matchFormat: "BestOf3" as const,
    player1Id,
    player1Name,
    player2Id: "pid-test-opponent-001",
    player2Name: "Zzqtest Opponentplayer",
    winnerId: player1Id,
    score: "6-4 6-4",
    retired: false,
    walkover: false,
    cancelled: false,
    scheduledStartAt,
    cutoffMinutes: 30,
    cutoffAt: new Date(scheduledStartAt.getTime() - 30 * 60_000),
    gameMarginsPlayer1: [{ player1Games: 6, player2Games: 4 }],
    rawSource: {},
  };
}

/** Fake provider standing in for API-Tennis: knows the player_key exists (get_players always
 * resolves any known key) but has no live standings row for a Challenger-only player, so tour is
 * null -- exactly the real, verified behavior confirmed live against API-Tennis. */
function makeFakeProvider(opts: { countryCode?: string | null; getPlayerCallCount?: { count: number } } = {}): TennisDataProvider {
  return {
    name: "fake",
    getStatus: () => ({ provider: "fake", connected: true, lastSuccessfulCallAt: null, lastError: null }),
    searchPlayers: async (): Promise<PlayerSummary[]> => [],
    getPlayer: async (playerId: string): Promise<PlayerProfile | null> => {
      if (opts.getPlayerCallCount) opts.getPlayerCallCount.count += 1;
      if (playerId === NEVER_SEEN_ID) return null; // provider genuinely has no record at all
      return {
        id: playerId,
        name: CHALLENGER_ONLY_NAME,
        fullName: null,
        countryCode: opts.countryCode ?? null,
        currentRank: null,
        tour: null, // not in current live standings
        age: null,
        plays: null,
      };
    },
    getPlayerMatches: async () => [],
    getUpcomingFixtures: async () => [],
    getUpcomingFixturesRange: async () => [],
    getHeadToHead: async (player1Id: string, player2Id: string) => ({ player1Id, player2Id, meetings: [] }),
    getCompletedMatchesByDateRange: async () => [],
  };
}

test("player identity resolution across historical match records", async (t) => {
  const [inserted] = await db.insert(historicalMatchesTable).values(makeMatch(CHALLENGER_ONLY_ID, CHALLENGER_ONLY_NAME)).returning({ id: historicalMatchesTable.id });

  t.after(async () => {
    await db.delete(historicalMatchesTable).where(inArray(historicalMatchesTable.id, [inserted.id]));
  });

  await t.test("resolvePlayerProfile falls back to a real historical tour when standings have none", async () => {
    const profile = await resolvePlayerProfile(makeFakeProvider(), CHALLENGER_ONLY_ID);
    assert.ok(profile);
    assert.equal(profile!.tour, "Challenger");
    assert.equal(profile!.source, "historical-match");
  });

  await t.test("resolvePlayerProfile returns null when the provider has never heard of the player_key at all", async () => {
    const profile = await resolvePlayerProfile(makeFakeProvider(), NEVER_SEEN_ID);
    assert.equal(profile, null);
  });

  await t.test("searchKnownPlayers surfaces a player the live standings feed can't (found via our own real match history)", async () => {
    const results = await searchKnownPlayers(makeFakeProvider(), "Zzqtest Challengerplayer");
    const match = results.find((p) => p.id === CHALLENGER_ONLY_ID);
    assert.ok(match, "expected the Challenger-only player to be found via historical match records");
    assert.equal(match!.source, "historical-match");
    assert.equal(match!.currentRank, null); // honestly no live ranking -- never guessed
    assert.equal(match!.tour, "Challenger");
  });

  await t.test("searchKnownPlayers never returns doubles-pair rows (names joined with '/')", async () => {
    const results = await searchKnownPlayers(makeFakeProvider(), "Opponentplayer");
    for (const r of results) {
      assert.ok(!r.name.includes("/"), `expected no doubles-pair name, got "${r.name}"`);
    }
  });

  await t.test("searchKnownPlayers enriches a historical-match-only result with a real live country code", async () => {
    clearCountryCodeCacheForTests();
    const results = await searchKnownPlayers(makeFakeProvider({ countryCode: "ESP" }), "Zzqtest Challengerplayer");
    const match = results.find((p) => p.id === CHALLENGER_ONLY_ID);
    assert.ok(match);
    assert.equal(match!.countryCode, "ESP");
  });

  await t.test("searchKnownPlayers caches the enriched country code instead of re-calling the provider", async () => {
    clearCountryCodeCacheForTests();
    const callCount = { count: 0 };
    const provider = makeFakeProvider({ countryCode: "ESP", getPlayerCallCount: callCount });
    await searchKnownPlayers(provider, "Zzqtest Challengerplayer");
    const callsAfterFirstSearch = callCount.count;
    assert.ok(callsAfterFirstSearch > 0, "expected the first search to call getPlayer to enrich the country code");
    await searchKnownPlayers(provider, "Zzqtest Challengerplayer");
    assert.equal(callCount.count, callsAfterFirstSearch, "expected the second search to reuse the cached country code, not call getPlayer again");
  });

  await t.test("searchKnownPlayers leaves countryCode null when the provider lookup fails, never guessing", async () => {
    clearCountryCodeCacheForTests();
    const provider = makeFakeProvider({ countryCode: "ESP" });
    provider.getPlayer = async () => {
      throw new Error("simulated provider outage");
    };
    const results = await searchKnownPlayers(provider, "Zzqtest Challengerplayer");
    const match = results.find((p) => p.id === CHALLENGER_ONLY_ID);
    assert.ok(match);
    assert.equal(match!.countryCode, null);
  });
});
