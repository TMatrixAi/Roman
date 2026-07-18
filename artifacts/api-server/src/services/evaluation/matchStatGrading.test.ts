/**
 * Unit tests for the MatchStat results-fetcher and batch-based ledger grading.
 *
 * These tests use a fake TennisDataProvider so no real API calls are made. They verify:
 * - fetchMatchResultsBatch deduplicates player IDs (K calls for K unique players, not N calls for N predictions)
 * - fetch failures for one player do not abort results for other players
 * - gradePendingLedgerPredictionsFromBatch correctly grades a prediction when a match is found
 * - gradePendingLedgerPredictionsFromBatch leaves a prediction pending when no match is found
 * - gradePendingLedgerPredictionsFromBatch is idempotent (double-call is safe)
 *
 * Run with: pnpm --filter @workspace/api-server exec tsx --test src/services/evaluation/matchStatGrading.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { db, predictionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchMatchResultsBatch } from "./matchStatResultsFetcher";
import { gradePendingLedgerPredictionsFromBatch } from "./ledgerGrading";
import type {
  TennisDataProvider,
  PlayerSummary,
  PlayerProfile,
  MatchRecord,
  Fixture,
  HeadToHeadRecord,
  ProviderStatusInfo,
  HistoricalFixture,
  LiveScore,
} from "../tennisData";

// ── Fake provider ────────────────────────────────────────────────────────────

class FakeProvider implements TennisDataProvider {
  readonly name = "fake-grading-test-provider";
  readonly callLog: string[] = [];
  private _matches: Map<string, MatchRecord[]>;

  constructor(matchesByPlayerId: Map<string, MatchRecord[]> = new Map()) {
    this._matches = matchesByPlayerId;
  }

  async getPlayerMatches(playerId: string): Promise<MatchRecord[]> {
    this.callLog.push(playerId);
    if (!this._matches.has(playerId)) throw new Error(`Fake: no entry for player ${playerId}`);
    return this._matches.get(playerId)!;
  }

  // Required by interface but unused in these tests:
  async searchPlayers(): Promise<PlayerSummary[]> { return []; }
  async getPlayer(): Promise<PlayerProfile | null> { return null; }
  async getUpcomingFixtures(): Promise<Fixture[]> { return []; }
  async getUpcomingFixturesRange(): Promise<Fixture[]> { return []; }
  async getHeadToHead(p1: string, p2: string): Promise<HeadToHeadRecord> { return { player1Id: p1, player2Id: p2, meetings: [] }; }
  async getCompletedMatchesByDateRange(): Promise<HistoricalFixture[]> { return []; }
  async getLiveScores(): Promise<Map<string, LiveScore>> { return new Map(); }
  getStatus(): ProviderStatusInfo { return { provider: this.name, connected: true, lastSuccessfulCallAt: null, lastError: null }; }
}

function makeMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: "m1",
    date: new Date().toISOString(),
    tournamentName: "Wimbledon",
    tournamentLevel: "GrandSlam",
    round: "Final",
    matchFormat: "best_of_5",
    surface: "Grass",
    indoor: false,
    opponentId: "p2",
    opponentName: "Player Two",
    opponentRank: 2,
    result: "W",
    score: "6-4 6-2",
    retired: false,
    walkover: false,
    stats: null,
    opponentStats: null,
    setGameMargins: [],
    ...overrides,
  };
}

// ── fetchMatchResultsBatch tests ─────────────────────────────────────────────

test("fetchMatchResultsBatch deduplicates player IDs — K API calls for K unique players", async () => {
  const matchesMap = new Map<string, MatchRecord[]>([
    ["p1", [makeMatch({ opponentId: "p2" })]],
    ["p2", [makeMatch({ opponentId: "p1", result: "L" })]],
  ]);
  const provider = new FakeProvider(matchesMap);

  // Pass duplicated player IDs
  const batch = await fetchMatchResultsBatch(provider, ["p1", "p2", "p1", "p2", "p1"]);

  assert.equal(provider.callLog.length, 2, "should call provider exactly once per unique player");
  assert.ok(batch.matchesByPlayerId.has("p1"));
  assert.ok(batch.matchesByPlayerId.has("p2"));
  assert.equal(batch.fetchErrors.length, 0);
});

test("fetchMatchResultsBatch records an error for a failed player without aborting others", async () => {
  const matchesMap = new Map<string, MatchRecord[]>([
    ["p1", [makeMatch()]],
    // p2 deliberately absent — provider will throw
  ]);
  const provider = new FakeProvider(matchesMap);

  const batch = await fetchMatchResultsBatch(provider, ["p1", "p2"]);

  assert.equal(batch.fetchErrors.length, 1, "should record exactly one error");
  assert.ok(batch.fetchErrors[0].includes("p2"), "error should mention the failing player");
  assert.deepEqual(batch.matchesByPlayerId.get("p2"), [], "failed player gets empty array");
  assert.equal(batch.matchesByPlayerId.get("p1")!.length, 1, "successful player unaffected");
});

test("fetchMatchResultsBatch with empty player list returns empty batch with no errors", async () => {
  const provider = new FakeProvider();
  const batch = await fetchMatchResultsBatch(provider, []);
  assert.equal(provider.callLog.length, 0);
  assert.equal(batch.matchesByPlayerId.size, 0);
  assert.equal(batch.fetchErrors.length, 0);
});

// ── gradePendingLedgerPredictionsFromBatch tests ─────────────────────────────

const PLAYER_A = "grading-test-player-a";
const PLAYER_B = "grading-test-player-b";
const TEST_PREDICTION_PREFIX = "grading-test-";

// Helper: inserts a ledger prediction and returns its id. Cleans up after itself via
// the teardown block. Player IDs use the test-specific constants so real data is unaffected.
async function insertTestPrediction(createdAt: Date): Promise<number> {
  const [row] = await db
    .insert(predictionsTable)
    .values({
      player1Id: PLAYER_A,
      player1Name: "Player Alpha",
      player2Id: PLAYER_B,
      player2Name: "Player Beta",
      surface: "Hard",
      matchFormat: "best_of_3",
      tournamentLevel: null,
      tournamentName: "Test Tournament",
      predictedWinnerId: PLAYER_A,
      predictedWinnerName: "Player Alpha",
      calibratedProbability: 65,
      predictedWinnerProbability: 65,
      dataQuality: 50,
      dataQualityLabel: "MEDIUM",
      upsetRisk: "LOW",
      recommendation: "LEAN",
      predictedSetScore: "6-4 6-3",
      // Unique identity key per test run to avoid the unique-index collision
      matchIdentityKey: `test-grading-${Date.now()}-${Math.random()}`,
      inputSnapshotHash: `test-hash-${Date.now()}-${Math.random()}`,
      createdAt,
      engine: {},
    })
    .returning({ id: predictionsTable.id });
  return row.id;
}

async function cleanupTestPredictions() {
  // Delete only the rows inserted by this test file.
  // Using a name prefix to isolate without needing a separate test DB.
  await db
    .delete(predictionsTable)
    .where(eq(predictionsTable.player1Id, PLAYER_A));
}

test("gradePendingLedgerPredictionsFromBatch grades a prediction when a matching result is found", async () => {
  await cleanupTestPredictions();
  const createdAt = new Date(Date.now() - 3 * 60 * 60_000); // 3 hours ago (past MIN_AGE)
  const predId = await insertTestPrediction(createdAt);

  const batch = {
    matchesByPlayerId: new Map<string, MatchRecord[]>([
      [PLAYER_A, [makeMatch({ opponentId: PLAYER_B, result: "W", date: new Date().toISOString() })]],
      [PLAYER_B, []],
    ]),
    fetchErrors: [],
  };

  const summary = await gradePendingLedgerPredictionsFromBatch(batch);

  assert.equal(summary.graded, 1, "prediction should be graded");
  assert.equal(summary.errors.length, 0);

  const [graded] = await db.select().from(predictionsTable).where(eq(predictionsTable.id, predId));
  assert.equal(graded.actualWinnerId, PLAYER_A, "winner ID should be set");
  assert.ok(graded.resolvedAt !== null, "resolvedAt should be set");

  await cleanupTestPredictions();
});

test("gradePendingLedgerPredictionsFromBatch leaves a prediction pending when no match is found", async () => {
  await cleanupTestPredictions();
  const createdAt = new Date(Date.now() - 3 * 60 * 60_000);
  const predId = await insertTestPrediction(createdAt);

  const batch = {
    matchesByPlayerId: new Map<string, MatchRecord[]>([
      [PLAYER_A, []], // no matches for player A
      [PLAYER_B, []],
    ]),
    fetchErrors: [],
  };

  const summary = await gradePendingLedgerPredictionsFromBatch(batch);

  // Assert on the specific test row, not aggregate counts (which include real DB predictions).
  assert.ok(summary.unresolvedIds.includes(predId), "predId should be in unresolvedIds");

  const [still] = await db.select().from(predictionsTable).where(eq(predictionsTable.id, predId));
  assert.equal(still.actualWinnerId, null, "prediction should still be pending");

  await cleanupTestPredictions();
});

test("gradePendingLedgerPredictionsFromBatch is idempotent — second call is a safe no-op for the test row", async () => {
  await cleanupTestPredictions();
  const createdAt = new Date(Date.now() - 3 * 60 * 60_000);
  const predId = await insertTestPrediction(createdAt);

  const batch = {
    matchesByPlayerId: new Map<string, MatchRecord[]>([
      [PLAYER_A, [makeMatch({ opponentId: PLAYER_B, result: "L", date: new Date().toISOString() })]],
      [PLAYER_B, []],
    ]),
    fetchErrors: [],
  };

  await gradePendingLedgerPredictionsFromBatch(batch);
  const second = await gradePendingLedgerPredictionsFromBatch(batch);

  // The test prediction should have been graded in the first pass; the second pass should
  // not produce errors and should not re-grade it.
  assert.equal(second.errors.length, 0, "second call should not produce errors");
  // The test prediction is now resolved so it won't appear in unresolvedIds.
  assert.ok(!second.unresolvedIds.includes(predId), "already-graded prediction should not be unresolved again");

  await cleanupTestPredictions();
});

test("gradePendingLedgerPredictionsFromBatch skips predictions too recent to check", async () => {
  await cleanupTestPredictions();
  const createdAt = new Date(Date.now() - 5 * 60_000); // only 5 minutes ago — below MIN_AGE
  const predId = await insertTestPrediction(createdAt);

  const batch = {
    matchesByPlayerId: new Map<string, MatchRecord[]>([
      [PLAYER_A, [makeMatch({ opponentId: PLAYER_B, result: "W", date: new Date().toISOString() })]],
      [PLAYER_B, []],
    ]),
    fetchErrors: [],
  };

  await gradePendingLedgerPredictionsFromBatch(batch);

  // Regardless of what other predictions get graded, the test-specific recent one must NOT be graded.
  const [still] = await db.select().from(predictionsTable).where(eq(predictionsTable.id, predId));
  assert.equal(still.actualWinnerId, null, "too-recent prediction must not be graded");

  await cleanupTestPredictions();
});

test("gradePendingLedgerPredictionsFromBatch surfaces batch fetch errors in summary", async () => {
  await cleanupTestPredictions();

  const batch = {
    matchesByPlayerId: new Map<string, MatchRecord[]>(),
    fetchErrors: ["Player p99: rate limited by MatchStat provider"],
  };

  const summary = await gradePendingLedgerPredictionsFromBatch(batch);
  assert.ok(
    summary.errors.some((e) => e.includes("p99")),
    "batch fetch errors should appear in summary errors",
  );

  await cleanupTestPredictions();
});
