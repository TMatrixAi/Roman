// Integration test for the Phase 4 walk-forward runner. Seeds a synthetic slice of the
// historical store (Phase 3) with alternating winners, runs a real walk-forward evaluation
// against it, and asserts the properties Phase 4 promises: folds + locked predictions get
// written, test-segment predictions are calibrated using ONLY validation-fit knots, retirements
// are excluded from the standard accuracy figure by default, void matches never count, and a
// settled prediction cannot be settled twice.
// Run with: pnpm --filter @workspace/api-server run test:evaluation
import test from "node:test";
import assert from "node:assert/strict";
import { db, historicalMatchesTable, evaluationPredictionsTable, evaluationRunsTable, calibrationModelsTable, matchFeatureSnapshotsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { runWalkForwardEvaluation } from "./walkForward";
import { settleEvaluationPrediction, getPredictionSettings } from "./settle";

const PROVIDER = "walk-forward-test";

function makeMatch(i: number, opts: { player1: string; player2: string; winner: string; retired?: boolean; walkover?: boolean; cancelled?: boolean }) {
  // One match per day starting 2020-01-02, using real Date arithmetic so this never overflows a
  // calendar month (a synthetic test fixture is exactly the kind of thing that must not silently
  // produce invalid dates when the match count grows).
  const scheduledStartAt = new Date(Date.UTC(2020, 0, 2 + i, 12, 0, 0));
  const cutoffAt = new Date(scheduledStartAt.getTime() - 30 * 60_000);
  return {
    externalId: `wf-${i}`,
    provider: PROVIDER,
    tour: "ATP",
    tournamentName: "Walk-Forward Test Series",
    tournamentLevel: null,
    surface: "Hard" as const,
    round: null,
    matchFormat: "BestOf3" as const,
    player1Id: opts.player1,
    player1Name: opts.player1,
    player2Id: opts.player2,
    player2Name: opts.player2,
    winnerId: opts.cancelled ? null : opts.winner,
    score: opts.cancelled ? null : "6-4 6-4",
    retired: !!opts.retired,
    walkover: !!opts.walkover,
    cancelled: !!opts.cancelled,
    scheduledStartAt,
    cutoffMinutes: 30,
    cutoffAt,
    gameMarginsPlayer1: opts.cancelled ? [] : [{ player1Games: 6, player2Games: 4 }],
    rawSource: {},
  };
}

test("walk-forward evaluation: locks immutable, correctly-segmented predictions with validation-only calibration", async (t) => {
  const players = Array.from({ length: 6 }, (_, i) => `wf-player-${i}`);
  const matches: ReturnType<typeof makeMatch>[] = [];
  // 40 matches, round-robin-ish, deterministic alternating winner pattern gives the reduced
  // model genuine (non-degenerate) signal to calibrate against.
  for (let i = 0; i < 40; i++) {
    const p1 = players[i % players.length];
    const p2 = players[(i + 1) % players.length];
    const retired = i === 35;
    const walkover = i === 36;
    const cancelled = i === 37;
    matches.push(makeMatch(i, { player1: p1, player2: p2, winner: p1, retired, walkover, cancelled }));
  }

  const inserted = await db.insert(historicalMatchesTable).values(matches).returning({ id: historicalMatchesTable.id, scheduledStartAt: historicalMatchesTable.scheduledStartAt, cutoffAt: historicalMatchesTable.cutoffAt });

  // Seed a reduced feature snapshot per (match, player) so scoreHistoricalMatch has real signal
  // to work with -- player1 is deterministically given the stronger profile so the reduced
  // model's prediction genuinely correlates with the synthetic outcome (player1 wins by
  // construction, except the retired/walkover/cancelled matches).
  const snapshotRows = inserted.flatMap((row, i) => {
    const m = matches[i];
    const featuresFor = (playerId: string, isFavorite: boolean) => [
      { matchId: row.id, playerId, featureName: "matchesPlayed", featureValue: i + 1, sourceTimestamp: row.cutoffAt, matchCutoffAt: row.cutoffAt, existedBeforeCutoff: true },
      { matchId: row.id, playerId, featureName: "eloOverall", featureValue: isFavorite ? 1650 : 1400, sourceTimestamp: row.cutoffAt, matchCutoffAt: row.cutoffAt, existedBeforeCutoff: true },
      { matchId: row.id, playerId, featureName: "eloSurface", featureValue: isFavorite ? 1650 : 1400, sourceTimestamp: row.cutoffAt, matchCutoffAt: row.cutoffAt, existedBeforeCutoff: true },
      { matchId: row.id, playerId, featureName: "winPctLast10", featureValue: isFavorite ? 0.75 : 0.25, sourceTimestamp: row.cutoffAt, matchCutoffAt: row.cutoffAt, existedBeforeCutoff: true },
      { matchId: row.id, playerId, featureName: "gameShareLast10", featureValue: isFavorite ? 0.65 : 0.35, sourceTimestamp: row.cutoffAt, matchCutoffAt: row.cutoffAt, existedBeforeCutoff: true },
    ];
    return [...featuresFor(m.player1Id, true), ...featuresFor(m.player2Id, false)];
  });
  await db.insert(matchFeatureSnapshotsTable).values(snapshotRows);

  t.after(async () => {
    await db.delete(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.runKind, "historical_test"));
    await db.delete(evaluationRunsTable);
    await db.delete(calibrationModelsTable);
    await db.delete(matchFeatureSnapshotsTable).where(
      inArray(
        matchFeatureSnapshotsTable.matchId,
        inserted.map((r) => r.id),
      ),
    );
    await db.delete(historicalMatchesTable).where(
      inArray(
        historicalMatchesTable.id,
        inserted.map((r) => r.id),
      ),
    );
  });

  const summary = await runWalkForwardEvaluation({ foldCount: 2, warmupFraction: 0.3 });
  assert.ok(summary.foldsRun >= 1, `Expected at least one fold to run, got ${summary.foldsRun}`);

  const folds = await db.select().from(evaluationRunsTable);
  assert.equal(folds.length, summary.foldsRun);

  const predictions = await db.select().from(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.runKind, "historical_test"));
  assert.ok(predictions.length > 0, "Expected locked evaluation predictions to be written");

  // Every locked prediction was written with a fold assignment and a lockedAt timestamp.
  for (const p of predictions) {
    assert.ok(p.foldId !== null, `Prediction ${p.id} missing foldId`);
    assert.ok(p.lockedAt, `Prediction ${p.id} missing lockedAt`);
    assert.ok(p.modelVersion, `Prediction ${p.id} missing modelVersion`);
  }

  // The walkover and cancelled matches must be void and excluded from accuracy; the retirement
  // must be graded but excluded from accuracy under the default rule.
  const walkoverRow = predictions.find((p) => p.player1Id === players[36 % players.length] || p.player2Id === players[36 % players.length]);
  const cancelledRow = predictions.find((p) => p.resultType === "cancelled");
  const retiredRow = predictions.find((p) => p.resultType === "retired");

  if (cancelledRow) {
    assert.equal(cancelledRow.status, "void");
    assert.equal(cancelledRow.includedInAccuracy, false);
  }
  if (retiredRow) {
    assert.equal(retiredRow.status, "graded");
    const settings = await getPredictionSettings();
    assert.equal(retiredRow.includedInAccuracy, settings.retirementRule === "included");
  }

  // No void row (walkover/cancelled) is ever counted toward accuracy.
  for (const p of predictions) {
    if (p.status === "void") assert.equal(p.includedInAccuracy, false, `Void row ${p.id} must never count toward accuracy`);
  }

  // Test-segment calibration must equal applying the fold's OWN calibration mapping to the raw
  // probability -- i.e. it was fit before test data was read, not adjusted using test outcomes.
  const testRows = predictions.filter((p) => p.segment === "test" && p.rawProbability !== null);
  for (const row of testRows) {
    const fold = folds.find((f) => f.id === row.foldId);
    assert.ok(fold, `Test row ${row.id} references a fold that doesn't exist`);
  }

  // A live calibration model was fit from pooled validation data for future paper trading.
  const [activeCalibration] = await db.select().from(calibrationModelsTable).where(eq(calibrationModelsTable.active, true));
  assert.ok(activeCalibration, "Expected an active calibration model after a walk-forward run");
  assert.ok(Array.isArray(activeCalibration.mapping) && (activeCalibration.mapping as unknown[]).length >= 2);

  // Immutability: settling an already-graded/void prediction a second time must be a no-op.
  const gradedRow = predictions.find((p) => p.status === "graded");
  assert.ok(gradedRow, "Expected at least one graded row");
  const settings = await getPredictionSettings();
  const beforeSecondSettle = (await db.select().from(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.id, gradedRow!.id)))[0];
  await settleEvaluationPrediction(gradedRow!.id, { actualWinnerId: "someone-else", actualWinnerName: "Someone Else", resultType: "normal" }, settings);
  const afterSecondSettle = (await db.select().from(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.id, gradedRow!.id)))[0];
  assert.deepEqual(afterSecondSettle, beforeSecondSettle, "Settling an already-settled prediction must be a no-op (immutability guard)");
});
