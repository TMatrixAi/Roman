/**
 * Tests for enrichPlayerRankFromSearch — the "exactly one exact-name match" safety rule.
 *
 * Key invariants:
 *  - Already has a rank → profile returned unchanged, provider never called.
 *  - Exactly one exact-normalized-name match with a rank → rank adopted.
 *  - Multiple exact-normalized-name matches → no enrichment (ambiguous identity).
 *  - No exact match (partial name, wrong name) → rank stays null.
 *  - Provider throws → rank stays null, no exception propagated to caller.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx --test src/services/tennisData/playerIdentity.enrichRank.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { enrichPlayerRankFromSearch } from "./playerIdentity";
import { ProviderUnavailableError } from "./types";
import type { PlayerProfile, PlayerSummary, TennisDataProvider, LiveScore } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    id: "api-tennis-123",
    name: "Rafael Nadal",
    fullName: "Rafael Nadal",
    countryCode: "ES",
    currentRank: null,
    tour: "ATP",
    age: 38,
    plays: "Right-Handed",
    ...overrides,
  };
}

function makeSummary(name: string, rank: number | null): PlayerSummary {
  return {
    id: `matchstat-${name.replace(/\s/g, "-")}`,
    name,
    countryCode: null,
    currentRank: rank,
    tour: "ATP",
  };
}

/** Creates a minimal provider that returns the given search results. Tracks searchCallCount. */
function makeProvider(
  searchResults: PlayerSummary[],
  opts: { throws?: boolean } = {},
): TennisDataProvider & { searchCallCount: number } {
  const provider = {
    name: "TestProvider" as const,
    searchCallCount: 0,
    getStatus: () => ({ provider: "TestProvider", connected: true, lastSuccessfulCallAt: null as string | null, lastError: null as string | null }),
    searchPlayers: async (_query: string): Promise<PlayerSummary[]> => {
      provider.searchCallCount++;
      if (opts.throws) throw new ProviderUnavailableError("rate limited");
      return searchResults;
    },
    getPlayer: async (): Promise<null> => null,
    getPlayerMatches: async () => [],
    getUpcomingFixtures: async () => [],
    getUpcomingFixturesRange: async () => [],
    getHeadToHead: async () => ({ player1Id: "a", player2Id: "b", meetings: [] }),
    getCompletedMatchesByDateRange: async () => [],
    getLiveScores: async (): Promise<Map<string, LiveScore>> => new Map(),
  };
  return provider;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("player already has a rank → profile unchanged, provider never called", async () => {
  const player = makeProfile({ currentRank: 5 });
  const provider = makeProvider([makeSummary("Rafael Nadal", 7)]);
  const result = await enrichPlayerRankFromSearch(provider, player);
  assert.equal(result.currentRank, 5, "Existing rank must not be overwritten");
  assert.equal(provider.searchCallCount, 0, "Provider must not be called when rank is already set");
});

test("exactly one exact-name match with a rank → rank adopted", async () => {
  const player = makeProfile({ currentRank: null });
  const provider = makeProvider([
    makeSummary("Novak Djokovic", 1),  // different name, not a match
    makeSummary("Rafael Nadal", 2),    // exact match
    makeSummary("Carlos Alcaraz", 3),  // different name, not a match
  ]);
  const result = await enrichPlayerRankFromSearch(provider, player);
  assert.equal(result.currentRank, 2, "Rank should be adopted from the one exact match");
  assert.equal(result.id, player.id, "Player ID must not change");
  assert.equal(result.name, player.name, "Player name must not change");
});

test("multiple exact-normalized-name matches → no enrichment (ambiguous identity)", async () => {
  const player = makeProfile({ name: "Alex Smith", currentRank: null });
  const provider = makeProvider([
    makeSummary("Alex Smith", 100),   // exact match — ATP player
    makeSummary("Alex Smith", 55),    // exact match — different player, same name
  ]);
  const result = await enrichPlayerRankFromSearch(provider, player);
  assert.equal(result.currentRank, null, "Must not enrich when multiple candidates share the same name");
});

test("exact-name match exists but has no rank → no enrichment", async () => {
  const player = makeProfile({ currentRank: null });
  const provider = makeProvider([
    makeSummary("Rafael Nadal", null),  // exact name match, but rank is null
  ]);
  const result = await enrichPlayerRankFromSearch(provider, player);
  assert.equal(result.currentRank, null, "Must not enrich when the only match lacks a rank");
});

test("no search result matches the player name → rank stays null", async () => {
  const player = makeProfile({ currentRank: null });
  const provider = makeProvider([
    makeSummary("Novak Djokovic", 1),
    makeSummary("Carlos Alcaraz", 2),
  ]);
  const result = await enrichPlayerRankFromSearch(provider, player);
  assert.equal(result.currentRank, null, "Rank must stay null when no exact name match is found");
});

test("partial name in result does not match (no fuzzy matching)", async () => {
  const player = makeProfile({ name: "Rafael Nadal", currentRank: null });
  const provider = makeProvider([
    makeSummary("Rafael", 10),         // only first name — must not match
    makeSummary("Nadal", 11),          // only last name — must not match
    makeSummary("R. Nadal", 12),       // initial form — normalizes to 'r nadal', ≠ 'rafael nadal'
  ]);
  const result = await enrichPlayerRankFromSearch(provider, player);
  assert.equal(result.currentRank, null, "Partial names and initial forms must not match — exact normalized name only");
});

test("provider throws ProviderUnavailableError → rank stays null, no exception propagated", async () => {
  const player = makeProfile({ currentRank: null });
  const provider = makeProvider([], { throws: true });
  const result = await enrichPlayerRankFromSearch(provider, player);
  assert.equal(result.currentRank, null, "Rank must stay null when provider is unavailable");
});

test("accent/diacritic in player name matches normalized search result", async () => {
  // "Novak Đoković" normalizes to "novak dokovic" (Đ→d, ć→c via NFD).
  // "Novak Dokovic" also normalizes to "novak dokovic". They should be treated as the same name.
  const player = makeProfile({ name: "Novak Đoković", currentRank: null });
  const provider = makeProvider([
    makeSummary("Novak Dokovic", 1),   // accent-stripped form — same normalized result
  ]);
  const result = await enrichPlayerRankFromSearch(provider, player);
  assert.equal(result.currentRank, 1, "Accent-folded player name should match the normalized search result");
});

test("exactly one match among many candidates with same partial name → rank adopted", async () => {
  // "Rafael Nadal" should match exactly, while "Rafael Moya" and "Rafael Osuna" are different.
  const player = makeProfile({ name: "Rafael Nadal", currentRank: null });
  const provider = makeProvider([
    makeSummary("Rafael Moya", 80),
    makeSummary("Rafael Nadal", 3),
    makeSummary("Rafael Osuna", 200),
  ]);
  const result = await enrichPlayerRankFromSearch(provider, player);
  assert.equal(result.currentRank, 3);
});
