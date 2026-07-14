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

test("searchLedgerPlayers: a short surname that is not actually anyone's surname finds no candidates (not a wall of unrelated substring hits)", async () => {
  const buenoId = `${RUN_TAG}-bueno`;
  const opponentId = `${RUN_TAG}-opponentBu`;
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({
        player1Id: buenoId,
        player1Name: "G. Bueno",
        player2Id: opponentId,
        player2Name: "Test Opponent",
      }),
    ])
    .returning({ id: predictionsTable.id });

  try {
    const results = await searchLedgerPlayers("Bu");
    assert.ok(
      !results.some((r) => r.id === buenoId),
      `"Bu" should not substring-match unrelated "G. Bueno", got: ${JSON.stringify(results)}`,
    );
  } finally {
    await cleanup(inserted.map((r) => r.id));
  }
});

test("searchLedgerPlayers: a short bare surname that IS a real whole-token surname still resolves (e.g. \"Zhu\" -> \"E. Zhu\")", async () => {
  const zhuId = `${RUN_TAG}-zhuE`;
  const opponentId = `${RUN_TAG}-opponentZhu`;
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({
        player1Id: zhuId,
        player1Name: "E. Zhu",
        player2Id: opponentId,
        player2Name: "Test Opponent",
      }),
    ])
    .returning({ id: predictionsTable.id });

  try {
    const results = await searchLedgerPlayers("Zhu");
    assert.ok(
      results.some((r) => r.id === zhuId),
      `expected "Zhu" to find "E. Zhu", got: ${JSON.stringify(results)}`,
    );
  } finally {
    await cleanup(inserted.map((r) => r.id));
  }
});

test("searchLedgerPlayers: a short surname query does not spuriously match an unrelated player via the initial-match rule (e.g. \"Bu\" vs \"B. Tomic\")", async () => {
  const tomicId = `${RUN_TAG}-tomic`;
  const opponentId = `${RUN_TAG}-opponentTomic`;
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({
        player1Id: tomicId,
        player1Name: "B. Tomic",
        player2Id: opponentId,
        player2Name: "Test Opponent",
      }),
    ])
    .returning({ id: predictionsTable.id });

  try {
    const results = await searchLedgerPlayers("Bu");
    assert.ok(
      !results.some((r) => r.id === tomicId),
      `"Bu" should not match "B. Tomic" via the initial-match rule, got: ${JSON.stringify(results)}`,
    );
  } finally {
    await cleanup(inserted.map((r) => r.id));
  }
});

test("searchLedgerPlayers: doubles-pairing rows are never returned as a singles candidate", async () => {
  const suresh1Id = `${RUN_TAG}-suresh1`;
  const suresh2Id = `${RUN_TAG}-suresh2`;
  const doublesId = `${RUN_TAG}-doublesSuresh`;
  const opponentId = `${RUN_TAG}-opponentSuresh`;
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({
        player1Id: suresh1Id,
        player1Name: "D. Suresh",
        player2Id: opponentId,
        player2Name: "Test Opponent",
      }),
      baseRow({
        player1Id: suresh2Id,
        player1Name: "K. Suresh",
        player2Id: opponentId,
        player2Name: "Test Opponent",
      }),
      baseRow({
        player1Id: doublesId,
        player1Name: "Vishal Balsekar/ Suresh",
        player2Id: opponentId,
        player2Name: "Test Opponent",
      }),
    ])
    .returning({ id: predictionsTable.id });

  try {
    const results = await searchLedgerPlayers("Suresh");
    const ids = results.map((r) => r.id);
    assert.ok(ids.includes(suresh1Id) && ids.includes(suresh2Id), `expected both real Sureshes, got: ${JSON.stringify(results)}`);
    assert.ok(!ids.includes(doublesId), `doubles-pairing row should never be a singles candidate, got: ${JSON.stringify(results)}`);
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
