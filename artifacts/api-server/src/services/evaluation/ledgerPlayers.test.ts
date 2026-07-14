// Unit test for the Ledger's paste-search player lookup. Inserts its own throwaway rows (with
// player ids/names namespaced to this test run) so it never asserts exact counts against the
// shared predictions table -- see .agents/memory/test-isolation-against-live-tables.md.
// Run with: pnpm --filter @workspace/api-server run test:evaluation
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, predictionsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { searchLedgerPlayers } from "./ledgerPlayers";

const RUN_TAG = `ledger-players-test-${Date.now()}`;

function baseRow(overrides: Partial<typeof predictionsTable.$inferInsert>) {
  return {
    player1Id: `${RUN_TAG}-p1`,
    player1Name: "Test Player One",
    player2Id: `${RUN_TAG}-p2`,
    player2Name: "Test Player Two",
    surface: "Hard",
    matchFormat: "BestOf3",
    tournamentLevel: null,
    tournamentName: "Test Open",
    predictedWinnerId: `${RUN_TAG}-p1`,
    predictedWinnerName: "Test Player One",
    calibratedProbability: 55,
    predictedWinnerProbability: 55,
    dataQuality: 80,
    dataQualityLabel: "Good",
    upsetRisk: "Low",
    recommendation: "MODERATE_LEAN",
    predictedSetScore: "2-1",
    engine: {},
    matchIdentityKey: `${RUN_TAG}-${randomUUID()}`,
    inputSnapshotHash: randomUUID(),
    ...overrides,
  } satisfies typeof predictionsTable.$inferInsert;
}

async function cleanup(ids: number[]) {
  if (ids.length > 0) await db.delete(predictionsTable).where(inArray(predictionsTable.id, ids));
}

test("searchLedgerPlayers: a full pasted first name resolves a player stored under a bare initial", async () => {
  const draxlId = `${RUN_TAG}-draxl`;
  const opponentId = `${RUN_TAG}-opponent`;
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({
        player1Id: draxlId,
        player1Name: "L. Draxl",
        player2Id: opponentId,
        player2Name: "Test Opponent",
      }),
    ])
    .returning({ id: predictionsTable.id });

  try {
    const results = await searchLedgerPlayers("Liam Draxl");
    assert.ok(
      results.some((r) => r.id === draxlId),
      `expected "Liam Draxl" to find the stored "L. Draxl" row, got: ${JSON.stringify(results)}`,
    );
  } finally {
    await cleanup(inserted.map((r) => r.id));
  }
});

test("searchLedgerPlayers: a full first name does not match an unrelated player with a different initial", async () => {
  const draxlId = `${RUN_TAG}-draxl2`;
  const opponentId = `${RUN_TAG}-opponent2`;
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({
        player1Id: draxlId,
        player1Name: "L. Draxl",
        player2Id: opponentId,
        player2Name: "Test Opponent",
      }),
    ])
    .returning({ id: predictionsTable.id });

  try {
    const results = await searchLedgerPlayers("Marcus Draxl");
    assert.ok(
      !results.some((r) => r.id === draxlId),
      `"Marcus Draxl" should not match "L. Draxl" (wrong first-letter initial)`,
    );
  } finally {
    await cleanup(inserted.map((r) => r.id));
  }
});

test("searchLedgerPlayers: genuine surname ambiguity between two initial-abbreviated players is still reported (both returned)", async () => {
  const zhouYId = `${RUN_TAG}-zhouY`;
  const zhouZId = `${RUN_TAG}-zhouZ`;
  const opponentId = `${RUN_TAG}-opponent3`;
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({
        player1Id: zhouYId,
        player1Name: "Y. Zhou",
        player2Id: opponentId,
        player2Name: "Test Opponent",
      }),
      baseRow({
        player1Id: zhouZId,
        player1Name: "Z. Zhou",
        player2Id: opponentId,
        player2Name: "Test Opponent",
      }),
    ])
    .returning({ id: predictionsTable.id });

  try {
    const results = await searchLedgerPlayers("Zhou");
    const ids = results.map((r) => r.id);
    assert.ok(ids.includes(zhouYId) && ids.includes(zhouZId), `expected both Zhous, got: ${JSON.stringify(results)}`);
  } finally {
    await cleanup(inserted.map((r) => r.id));
  }
});

test("searchLedgerPlayers: multi-word full names match multi-initial stored names (e.g. \"James Kent Trotter\" -> \"J. K. Trotter\")", async () => {
  const trotterId = `${RUN_TAG}-trotter`;
  const opponentId = `${RUN_TAG}-opponent4`;
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({
        player1Id: trotterId,
        player1Name: "J. K. Trotter",
        player2Id: opponentId,
        player2Name: "Test Opponent",
      }),
    ])
    .returning({ id: predictionsTable.id });

  try {
    const results = await searchLedgerPlayers("James Kent Trotter");
    assert.ok(
      results.some((r) => r.id === trotterId),
      `expected "James Kent Trotter" to find "J. K. Trotter", got: ${JSON.stringify(results)}`,
    );
  } finally {
    await cleanup(inserted.map((r) => r.id));
  }
});
