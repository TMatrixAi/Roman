// Regression test for Task #150: the `evaluation_predictions_prevent_settled_update` DB trigger
// (lib/db/src/sql/immutability-trigger.sql) must freeze `model_agreement`, `upset_risk_tier`, and
// the market-odds columns once a row leaves 'pending', the same way it already freezes the
// original outcome columns. Uses its own throwaway row (player ids namespaced to this test run) so
// it never asserts exact counts against the shared evaluation_predictions table -- see
// .agents/memory/test-isolation-against-live-tables.md.
// Run with: pnpm --filter @workspace/api-server run test:evaluation
import test from "node:test";
import assert from "node:assert/strict";
import { db, evaluationPredictionsTable, type InsertEvaluationPrediction } from "@workspace/db";
import { eq } from "drizzle-orm";

// The trigger's RAISE EXCEPTION message ends up on the underlying pg error's `cause`, not on the
// wrapping drizzle "Failed query" error's own `.message` -- match on the real, nested cause.
function rejectsAsSettled(err: unknown): boolean {
  const cause = (err as { cause?: { message?: string } } | undefined)?.cause;
  return typeof cause?.message === "string" && cause.message.includes("already settled");
}

const RUN_TAG = `immutability-test-${Date.now()}`;

function baseValues(overrides: Partial<InsertEvaluationPrediction> = {}): InsertEvaluationPrediction {
  return {
    runKind: "paper_trade",
    player1Id: `${RUN_TAG}-p1`,
    player1Name: "Test Player One",
    player2Id: `${RUN_TAG}-p2`,
    player2Name: "Test Player Two",
    scheduledStartAt: new Date("2026-01-01T12:00:00Z"),
    cutoffAt: new Date("2026-01-01T11:30:00Z"),
    modelVersion: "test-version",
    rawProbability: 55,
    calibratedProbability: 55,
    predictedWinnerId: `${RUN_TAG}-p1`,
    predictedWinnerName: "Test Player One",
    modelAgreement: "Strong Agreement",
    upsetRiskTier: "Low",
    oddsProvider: "the_odds_api",
    oddsPlayer1Decimal: 1.5,
    oddsPlayer2Decimal: 2.8,
    oddsFetchedAt: new Date("2026-01-01T11:00:00Z"),
    impliedProbability: 60,
    marketEdge: 2,
    status: "graded",
    actualWinnerId: `${RUN_TAG}-p1`,
    actualWinnerName: "Test Player One",
    resultType: "normal",
    includedInAccuracy: true,
    gradedAt: new Date("2026-01-01T14:00:00Z"),
    ...overrides,
  } satisfies InsertEvaluationPrediction;
}

async function insertSettledRow(): Promise<number> {
  const [row] = await db.insert(evaluationPredictionsTable).values(baseValues()).returning();
  assert.ok(row, "expected the settled test row to insert");
  return row.id;
}

async function cleanup(id: number) {
  await db.delete(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.id, id));
}

for (const { column, value } of [
  { column: "modelAgreement", value: "Weak Agreement" },
  { column: "upsetRiskTier", value: "High" },
  { column: "oddsProvider", value: "odds_api_io" },
  { column: "oddsPlayer1Decimal", value: 1.9 },
  { column: "oddsPlayer2Decimal", value: 2.1 },
  { column: "oddsFetchedAt", value: new Date("2026-01-02T00:00:00Z") },
  { column: "impliedProbability", value: 45 },
  { column: "marketEdge", value: -3 },
] as const) {
  test(`evaluation_predictions immutability trigger: rejects post-settlement edits to ${column}`, async () => {
    const id = await insertSettledRow();
    try {
      await assert.rejects(
        () =>
          db
            .update(evaluationPredictionsTable)
            .set({ [column]: value } as Partial<InsertEvaluationPrediction>)
            .where(eq(evaluationPredictionsTable.id, id)),
        rejectsAsSettled,
        `expected the trigger to reject an update to ${column} on a settled row`,
      );
    } finally {
      await cleanup(id);
    }
  });
}

test("evaluation_predictions immutability trigger: still permits the two documented bookkeeping exemptions", async () => {
  const id = await insertSettledRow();
  try {
    // calibratedProbability and foldId remain exempt -- the walk-forward runner legitimately
    // rewrites these on its own just-inserted, already-graded rows.
    await db.update(evaluationPredictionsTable).set({ calibratedProbability: 63 }).where(eq(evaluationPredictionsTable.id, id));
    const [afterCalibration] = await db.select().from(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.id, id));
    assert.equal(afterCalibration!.calibratedProbability, 63, "calibratedProbability must remain updatable after settlement");
  } finally {
    await cleanup(id);
  }
});

test("evaluation_predictions immutability trigger: rejects post-settlement edits to the original outcome columns too (no regression)", async () => {
  const id = await insertSettledRow();
  try {
    await assert.rejects(
      () => db.update(evaluationPredictionsTable).set({ actualWinnerId: `${RUN_TAG}-p2` }).where(eq(evaluationPredictionsTable.id, id)),
      rejectsAsSettled,
    );
  } finally {
    await cleanup(id);
  }
});
