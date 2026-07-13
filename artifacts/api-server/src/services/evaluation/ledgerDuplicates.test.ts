// Unit test for the Ledger's duplicate-trade detector. Inserts its own throwaway rows (with
// player ids namespaced to this test run) so it never asserts exact counts against the shared
// predictions table -- see .agents/memory/test-isolation-against-live-tables.md.
// Run with: pnpm --filter @workspace/api-server run test:evaluation
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, predictionsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { findDuplicatePredictionGroups } from "./ledgerDuplicates";

const RUN_TAG = `dup-test-${Date.now()}`;

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
    // This dedup tool intentionally inserts multiple rows that share the same
    // player/tournament/surface/format on purpose (that's what it's testing) -- give each row its
    // own random identity/hash so the unrelated matchIdentityKey+inputSnapshotHash uniqueness
    // constraint (added for the preventive duplicate-insert feature) never collides with these
    // deliberately-duplicate rows.
    matchIdentityKey: `${RUN_TAG}-${randomUUID()}`,
    inputSnapshotHash: randomUUID(),
    ...overrides,
  } satisfies typeof predictionsTable.$inferInsert;
}

async function cleanup(ids: number[]) {
  if (ids.length > 0) await db.delete(predictionsTable).where(inArray(predictionsTable.id, ids));
}

test("findDuplicatePredictionGroups: flags same match as duplicate even when predicted winner differs", async () => {
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({ predictedWinnerId: `${RUN_TAG}-p1`, predictedWinnerName: "Test Player One" }),
      // Same players/tournament/surface/format, but the simulator's randomness (pre-fix) flipped
      // which side this run favored -- must still be detected as the same real match.
      baseRow({ predictedWinnerId: `${RUN_TAG}-p2`, predictedWinnerName: "Test Player Two" }),
    ])
    .returning({ id: predictionsTable.id });
  const ids = inserted.map((r) => r.id);

  try {
    const groups = await findDuplicatePredictionGroups();
    const ourGroup = groups.find((g) => ids.includes(g.keepId));
    assert.ok(ourGroup, "the two same-match rows with different predicted winners must form a duplicate group");
    assert.equal(ourGroup!.keepId, ids[0], "the earliest-created row must be the one kept");
    assert.deepEqual(ourGroup!.removeIds, [ids[1]], "the later row must be the only one flagged for removal");
  } finally {
    await cleanup(ids);
  }
});

test("findDuplicatePredictionGroups: tournament-name comparison is trim/case-insensitive and treats null/empty as equal", async () => {
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({ tournamentName: "  Test Open  " }),
      baseRow({ tournamentName: "test open" }),
    ])
    .returning({ id: predictionsTable.id });
  const ids = inserted.map((r) => r.id);

  try {
    const groups = await findDuplicatePredictionGroups();
    const ourGroup = groups.find((g) => ids.includes(g.keepId));
    assert.ok(ourGroup, "differently-cased/whitespaced tournament names for the same match must still be grouped");
    assert.deepEqual(ourGroup!.removeIds, [ids[1]]);
  } finally {
    await cleanup(ids);
  }
});

test("findDuplicatePredictionGroups: never merges genuinely different matches (different surface, far apart in time)", async () => {
  // Different surface AND far enough apart in time to fall outside the time-proximity fallback
  // window too -- this is the "same pair meets again weeks later" case, never a duplicate.
  const early = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const late = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const inserted = await db
    .insert(predictionsTable)
    .values([baseRow({ surface: "Hard", createdAt: early }), baseRow({ surface: "Clay", createdAt: late })])
    .returning({ id: predictionsTable.id });
  const ids = inserted.map((r) => r.id);

  try {
    const groups = await findDuplicatePredictionGroups();
    const ourGroup = groups.find((g) => ids.includes(g.keepId) || g.removeIds.some((id) => ids.includes(id)));
    assert.equal(ourGroup, undefined, "a different surface far apart in time must never be treated as the same match");
  } finally {
    await cleanup(ids);
  }
});

test("findDuplicatePredictionGroups: flags same pair as duplicate when created minutes apart, even with different tournament/surface/format", async () => {
  // Mirrors the real unresolved-duplicate complaint: predicted once via Predict Now (no
  // tournament, Hard/BestOf3 defaults), then again minutes later via Custom Match with the
  // tournament filled in and the surface corrected.
  const first = new Date(Date.now() - 5 * 60 * 1000);
  const second = new Date();
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({ tournamentName: null, surface: "Hard", matchFormat: "BestOf3", createdAt: first }),
      baseRow({ tournamentName: "Test Open", surface: "Clay", matchFormat: "BestOf5", createdAt: second }),
    ])
    .returning({ id: predictionsTable.id });
  const ids = inserted.map((r) => r.id);

  try {
    const groups = await findDuplicatePredictionGroups();
    const ourGroup = groups.find((g) => ids.includes(g.keepId));
    assert.ok(ourGroup, "same-pair predictions created minutes apart must be flagged as duplicates despite differing tournament/surface/format");
    assert.equal(ourGroup!.keepId, ids[0], "the earliest-created row must be the one kept");
    assert.deepEqual(ourGroup!.removeIds, [ids[1]]);
  } finally {
    await cleanup(ids);
  }
});

test("findDuplicatePredictionGroups: does not flag same pair as duplicate when created hours apart with different tournament/surface/format", async () => {
  // Outside the time-proximity window and no exact-key match -- must not be merged, even though
  // it's the same two players.
  const early = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const late = new Date();
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({ tournamentName: null, surface: "Hard", matchFormat: "BestOf3", createdAt: early }),
      baseRow({ tournamentName: "Test Open", surface: "Clay", matchFormat: "BestOf5", createdAt: late }),
    ])
    .returning({ id: predictionsTable.id });
  const ids = inserted.map((r) => r.id);

  try {
    const groups = await findDuplicatePredictionGroups();
    const ourGroup = groups.find((g) => ids.includes(g.keepId) || g.removeIds.some((id) => ids.includes(id)));
    assert.equal(ourGroup, undefined, "same pair hours apart with differing tournament/surface/format must not be treated as a duplicate");
  } finally {
    await cleanup(ids);
  }
});

test("findDuplicatePredictionGroups: player order (which is player1 vs player2) does not prevent detection", async () => {
  const inserted = await db
    .insert(predictionsTable)
    .values([
      baseRow({ player1Id: `${RUN_TAG}-p1`, player1Name: "Test Player One", player2Id: `${RUN_TAG}-p2`, player2Name: "Test Player Two" }),
      baseRow({ player1Id: `${RUN_TAG}-p2`, player1Name: "Test Player Two", player2Id: `${RUN_TAG}-p1`, player2Name: "Test Player One" }),
    ])
    .returning({ id: predictionsTable.id });
  const ids = inserted.map((r) => r.id);

  try {
    const groups = await findDuplicatePredictionGroups();
    const ourGroup = groups.find((g) => ids.includes(g.keepId));
    assert.ok(ourGroup, "swapping which player is player1/player2 must not prevent duplicate detection");
    assert.deepEqual(ourGroup!.removeIds, [ids[1]]);
  } finally {
    await cleanup(ids);
  }
});
