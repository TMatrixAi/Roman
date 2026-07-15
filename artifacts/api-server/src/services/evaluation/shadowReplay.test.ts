// Integration test for the shadow-mode paper-trading replay (Task #159). Seeds a small synthetic
// slice of the historical store confined to a specific date range, replays it, and asserts the
// properties the task promises: rows land under runKind='paper_trade_shadow' only, re-running the
// same batch is a pure no-op append (no duplicates, no silent wipe), overwrite=true touches ONLY
// the named batch's own rows, a different batch label never steals another batch's already-scored
// matches, and nothing here ever touches historical_test or paper_trade rows.
// Run with: pnpm --filter @workspace/api-server run test:evaluation
import test from "node:test";
import assert from "node:assert/strict";
import { db, historicalMatchesTable, evaluationPredictionsTable, matchFeatureSnapshotsTable, calibrationModelsTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { runShadowPaperTradingReplay, listShadowReplayBatches } from "./shadowReplay";

// Suffixed per test process invocation -- this DB is shared with real production data and prior
// (possibly failed/interrupted) test runs, so a fixed external_id would collide with leftover
// rows from an earlier run instead of cleanly failing this run's own assertions.
const RUN_SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PROVIDER = `shadow-replay-test-${RUN_SUFFIX}`;

function makeMatch(i: number, opts: { player1: string; player2: string; winner: string }) {
  // All inside the replay window used below (2021-03-01 .. 2021-03-10).
  const scheduledStartAt = new Date(Date.UTC(2021, 2, 1 + i, 12, 0, 0));
  const cutoffAt = new Date(scheduledStartAt.getTime() - 30 * 60_000);
  return {
    externalId: `shadow-${RUN_SUFFIX}-${i}`,
    provider: PROVIDER,
    tour: "ATP",
    tournamentName: "Shadow Replay Test Series",
    tournamentLevel: null,
    surface: "Hard" as const,
    round: null,
    matchFormat: "BestOf3" as const,
    player1Id: opts.player1,
    player1Name: opts.player1,
    player2Id: opts.player2,
    player2Name: opts.player2,
    winnerId: opts.winner,
    score: "6-4 6-4",
    retired: false,
    walkover: false,
    cancelled: false,
    scheduledStartAt,
    cutoffMinutes: 30,
    cutoffAt,
    gameMarginsPlayer1: [{ player1Games: 6, player2Games: 4 }],
    rawSource: {},
  };
}

test("shadow-mode replay: append-only, distinctly-labeled batches, never touching other run kinds", async (t) => {
  const players = Array.from({ length: 4 }, (_, i) => `shadow-player-${i}`);
  const matches: ReturnType<typeof makeMatch>[] = [];
  for (let i = 0; i < 10; i++) {
    const p1 = players[i % players.length];
    const p2 = players[(i + 1) % players.length];
    matches.push(makeMatch(i, { player1: p1, player2: p2, winner: p1 }));
  }

  const inserted = await db
    .insert(historicalMatchesTable)
    .values(matches)
    .returning({ id: historicalMatchesTable.id, cutoffAt: historicalMatchesTable.cutoffAt, player1Id: historicalMatchesTable.player1Id, player2Id: historicalMatchesTable.player2Id });

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

  const batchA = `shadow-test-a-${Date.now()}`;
  const batchB = `shadow-test-b-${Date.now()}`;

  // Snapshot pre-existing historical_test / paper_trade rows so we can assert this suite never
  // touches them -- this DB is shared with real production evaluation history.
  const preExistingOtherKindIds = new Set(
    (await db.select({ id: evaluationPredictionsTable.id }).from(evaluationPredictionsTable).where(inArray(evaluationPredictionsTable.runKind, ["historical_test", "paper_trade", "live"]))).map(
      (r) => r.id,
    ),
  );

  t.after(async () => {
    await db.delete(evaluationPredictionsTable).where(inArray(evaluationPredictionsTable.shadowBatchLabel, [batchA, batchB]));
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

  // --- First run: batch A over the full window ---
  // Note: this fixture's first 3 round-robin matches (i=0,1,2) each introduce a brand-new player
  // with zero prior history -- `scoreHistoricalMatch` honestly returns null ("insufficient data")
  // for those, same as it would for anyone's real first-ever match. Only the remaining 7
  // (i=3..9, by which point every one of the 4 players has at least one prior match) are
  // scorable. This is structural to the fixture, not something either batch's claim state
  // controls, so it recurs identically for any other batch replaying this same range below.
  const summary1 = await runShadowPaperTradingReplay({ startDate: "2021-03-01", endDate: "2021-03-10", batchLabel: batchA });
  assert.equal(summary1.matchesInRange, 10);
  assert.equal(summary1.skippedInsufficientData, 3, "Expected the 3 structurally-unscorable warmup matches to be skipped");
  assert.equal(summary1.inserted, 7, "Expected the 7 matches with real prior history to be scored and inserted");
  assert.equal(summary1.deletedExistingBatchRows, 0);
  assert.equal(summary1.skippedAlreadyClaimed, 0);

  const rowsAfterFirst = await db.select().from(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.shadowBatchLabel, batchA));
  assert.equal(rowsAfterFirst.length, summary1.inserted);
  assert.ok(
    rowsAfterFirst.every((r) => r.runKind === "paper_trade_shadow"),
    "Every shadow-replay row must be runKind paper_trade_shadow",
  );
  assert.ok(
    rowsAfterFirst.every((r) => r.status === "graded"),
    "Every replayed match here is a clean normal result, so every row should already be graded",
  );

  // --- Re-running the SAME batch over the SAME range is a pure no-op append: no duplicates. ---
  const summary2 = await runShadowPaperTradingReplay({ startDate: "2021-03-01", endDate: "2021-03-10", batchLabel: batchA });
  assert.equal(summary2.inserted, 0, "Re-running the same batch/range must not insert duplicate rows");
  assert.equal(summary2.skippedAlreadyClaimed, summary1.inserted, "Every previously-claimed match must be reported as skipped, not silently dropped");
  const rowsAfterRerun = await db.select().from(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.shadowBatchLabel, batchA));
  assert.equal(rowsAfterRerun.length, rowsAfterFirst.length, "Row count must be unchanged after a no-op re-run");

  // --- A DIFFERENT batch label over the same matches must not steal or duplicate them -- the
  // shared (runKind, historicalMatchId) uniqueness means a match already claimed by batch A stays
  // claimed by batch A; batch B gets zero rows out of this overlapping range. ---
  const summaryOtherBatch = await runShadowPaperTradingReplay({ startDate: "2021-03-01", endDate: "2021-03-10", batchLabel: batchB });
  assert.equal(summaryOtherBatch.inserted, 0, "A different batch over an already-fully-claimed range must insert nothing");
  // Only the 7 matches batch A actually managed to score are "claimed" -- the 3 structurally
  // unscorable warmup matches were never claimed by anyone, so batch B independently (and
  // identically) reports them as insufficient data rather than already-claimed.
  assert.equal(summaryOtherBatch.skippedAlreadyClaimed, summary1.inserted);
  assert.equal(summaryOtherBatch.skippedInsufficientData, summary1.skippedInsufficientData);
  assert.equal(summaryOtherBatch.skippedAlreadyClaimed + summaryOtherBatch.skippedInsufficientData, summaryOtherBatch.matchesInRange);
  const batchBRows = await db.select().from(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.shadowBatchLabel, batchB));
  assert.equal(batchBRows.length, 0);

  // --- overwrite=true on batch A deletes ONLY batch A's rows, then re-inserts fresh ones under
  // the same label -- never touching batch B (which has none here) or any other run kind. ---
  const summaryOverwrite = await runShadowPaperTradingReplay({ startDate: "2021-03-01", endDate: "2021-03-10", batchLabel: batchA, overwrite: true });
  assert.equal(summaryOverwrite.deletedExistingBatchRows, rowsAfterFirst.length);
  assert.equal(summaryOverwrite.inserted, rowsAfterFirst.length, "Overwrite should re-insert exactly as many rows as it deleted for this fully-scorable fixture set");

  // --- Never touched historical_test / paper_trade / live rows that existed before this test. ---
  const otherKindRowsAfter = await db
    .select({ id: evaluationPredictionsTable.id })
    .from(evaluationPredictionsTable)
    .where(inArray(evaluationPredictionsTable.runKind, ["historical_test", "paper_trade", "live"]));
  const survivingPreExisting = otherKindRowsAfter.filter((r) => preExistingOtherKindIds.has(r.id));
  assert.equal(survivingPreExisting.length, preExistingOtherKindIds.size, "Shadow replay must never delete/alter historical_test or paper_trade/live rows");

  // --- Date range filtering: a narrower window only replays matches inside it. ---
  const narrowSummary = await runShadowPaperTradingReplay({ startDate: "2021-03-05", endDate: "2021-03-05", batchLabel: `${batchB}-narrow` });
  assert.equal(narrowSummary.matchesInRange, 1);
  t.after(async () => {
    await db.delete(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.shadowBatchLabel, `${batchB}-narrow`));
  });

  // --- listShadowReplayBatches reflects the batches we created, each isolated from the other. ---
  const batches = await listShadowReplayBatches();
  const batchAEntry = batches.find((b) => b.batchLabel === batchA);
  assert.ok(batchAEntry, "Expected batch A to appear in the batch listing");
  assert.equal(batchAEntry!.n, rowsAfterFirst.length);

  // --- blank batchLabel is rejected outright, never silently coerced to "(unlabeled)". ---
  await assert.rejects(() => runShadowPaperTradingReplay({ startDate: "2021-03-01", endDate: "2021-03-10", batchLabel: "   " }));

  // --- endDate before startDate is rejected. ---
  await assert.rejects(() => runShadowPaperTradingReplay({ startDate: "2021-03-10", endDate: "2021-03-01", batchLabel: `${batchB}-bad-range` }));
});

test("shadow-mode replay: applies the calibration mapping that was actually active as of each match's own cutoffAt (Task #160), not today's", async (t) => {
  const players = Array.from({ length: 2 }, (_, i) => `shadow-calib-player-${i}`);
  // scoreHistoricalMatch requires each player to have at least one PRIOR recorded match --
  // otherwise it returns null (insufficient data), same as it would for walk-forward's very
  // first match for a brand-new player. Seed a warmup match dated well before the one under
  // test so both players have real prior history by the time the June match is scored.
  const warmup = makeMatch(19, { player1: players[0], player2: players[1], winner: players[0] });
  warmup.scheduledStartAt = new Date(Date.UTC(2021, 4, 1, 12, 0, 0));
  warmup.cutoffAt = new Date(warmup.scheduledStartAt.getTime() - 30 * 60_000);
  const underTest = makeMatch(20, { player1: players[0], player2: players[1], winner: players[0] });
  underTest.scheduledStartAt = new Date(Date.UTC(2021, 5, 1, 12, 0, 0));
  underTest.cutoffAt = new Date(underTest.scheduledStartAt.getTime() - 30 * 60_000);
  const matches = [warmup, underTest];

  const inserted = await db
    .insert(historicalMatchesTable)
    .values(matches)
    .returning({ id: historicalMatchesTable.id, cutoffAt: historicalMatchesTable.cutoffAt, player1Id: historicalMatchesTable.player1Id, player2Id: historicalMatchesTable.player2Id });

  const row = inserted[1]; // the June match under test; feature snapshots only need to exist for it
  const featuresFor = (playerId: string, isFavorite: boolean) => [
    { matchId: row.id, playerId, featureName: "matchesPlayed", featureValue: 5, sourceTimestamp: row.cutoffAt, matchCutoffAt: row.cutoffAt, existedBeforeCutoff: true },
    { matchId: row.id, playerId, featureName: "eloOverall", featureValue: isFavorite ? 1700 : 1350, sourceTimestamp: row.cutoffAt, matchCutoffAt: row.cutoffAt, existedBeforeCutoff: true },
    { matchId: row.id, playerId, featureName: "eloSurface", featureValue: isFavorite ? 1700 : 1350, sourceTimestamp: row.cutoffAt, matchCutoffAt: row.cutoffAt, existedBeforeCutoff: true },
    { matchId: row.id, playerId, featureName: "winPctLast10", featureValue: isFavorite ? 0.8 : 0.2, sourceTimestamp: row.cutoffAt, matchCutoffAt: row.cutoffAt, existedBeforeCutoff: true },
    { matchId: row.id, playerId, featureName: "gameShareLast10", featureValue: isFavorite ? 0.7 : 0.3, sourceTimestamp: row.cutoffAt, matchCutoffAt: row.cutoffAt, existedBeforeCutoff: true },
  ];
  await db.insert(matchFeatureSnapshotsTable).values([...featuresFor(row.player1Id, true), ...featuresFor(row.player2Id, false)]);

  // Task #160: clear the ENTIRE calibration_models table for the duration of this test and
  // replace it with two synthetic rows at explicit, deliberately-chosen `fittedAt` timestamps --
  // one BEFORE the under-test match's cutoffAt, one AFTER it (and marked `active: true`, i.e.
  // "today's" mapping). This is the only way to deterministically prove the replay picks the
  // mapping that was genuinely in force on the match's OWN date, not whatever happens to be
  // `active` right now -- a plain deactivate/reactivate of the real active row (as this test used
  // to do) can no longer distinguish the two, since `active` is no longer what the lookup uses.
  const preExistingCalibrationRows = await db.select().from(calibrationModelsTable);
  if (preExistingCalibrationRows.length > 0) {
    await db.delete(calibrationModelsTable).where(
      inArray(
        calibrationModelsTable.id,
        preExistingCalibrationRows.map((c) => c.id),
      ),
    );
  }
  const beforeCutoffFittedAt = new Date(underTest.cutoffAt.getTime() - 14 * 24 * 60 * 60_000); // ~2 weeks before the match's own cutoff
  const afterCutoffFittedAt = new Date(underTest.cutoffAt.getTime() + 30 * 24 * 60 * 60_000); // ~1 month after -- this is the one that's `active` today
  const [historicallyActive] = await db
    .insert(calibrationModelsTable)
    .values({
      method: "isotonic",
      // Deliberately extreme (always outputs 5% for player1) so applying it is unmistakable.
      mapping: [
        { x: 0, y: 0.05 },
        { x: 1, y: 0.05 },
      ],
      validationSampleSize: 999,
      active: false,
      fittedAt: beforeCutoffFittedAt,
    })
    .returning();
  const [todaysActive] = await db
    .insert(calibrationModelsTable)
    .values({
      method: "isotonic",
      // A distinctly different mapping, fitted AFTER the under-test match's cutoff and left
      // `active: true` -- if the replay wrongly applied "today's active mapping" uniformly, this
      // is the one it would use instead of `historicallyActive`.
      mapping: [
        { x: 0, y: 0.95 },
        { x: 1, y: 0.95 },
      ],
      validationSampleSize: 999,
      active: true,
      fittedAt: afterCutoffFittedAt,
    })
    .returning();

  const batchLabel = `shadow-calib-test-${Date.now()}`;
  t.after(async () => {
    await db.delete(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.shadowBatchLabel, batchLabel));
    await db.delete(matchFeatureSnapshotsTable).where(eq(matchFeatureSnapshotsTable.matchId, row.id));
    await db.delete(historicalMatchesTable).where(
      inArray(
        historicalMatchesTable.id,
        inserted.map((r) => r.id),
      ),
    );
    await db.delete(calibrationModelsTable).where(inArray(calibrationModelsTable.id, [historicallyActive.id, todaysActive.id]));
    if (preExistingCalibrationRows.length > 0) {
      await db.insert(calibrationModelsTable).values(
        preExistingCalibrationRows.map((c) => ({
          method: c.method,
          mapping: c.mapping,
          validationSampleSize: c.validationSampleSize,
          validationDateRangeStart: c.validationDateRangeStart,
          validationDateRangeEnd: c.validationDateRangeEnd,
          active: c.active,
          isotonicHoldoutLogLoss: c.isotonicHoldoutLogLoss,
          plattHoldoutLogLoss: c.plattHoldoutLogLoss,
          holdoutSampleSize: c.holdoutSampleSize,
          fittedAt: c.fittedAt,
        })),
      );
    }
  });

  const summary = await runShadowPaperTradingReplay({ startDate: "2021-06-01", endDate: "2021-06-01", batchLabel });
  assert.equal(summary.inserted, 1);

  const [shadowRow] = await db.select().from(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.shadowBatchLabel, batchLabel));
  assert.ok(shadowRow, "Expected the shadow row to be inserted");
  assert.ok(shadowRow.rawProbability !== null && shadowRow.calibratedProbability !== null);
  // Player1 is the constructed favorite (higher Elo/form), so raw should favor them (>50), but
  // the mapping that was genuinely active as of THIS match's own cutoffAt (`historicallyActive`,
  // fitted before it) always maps to 5% -- proving calibratedProbability is NOT simply mirroring
  // rawProbability, and NOT using `todaysActive`'s 95% mapping either.
  assert.ok(shadowRow.rawProbability! > 50, "Expected the reduced model's raw probability to favor the constructed favorite");
  // The engine still applies its own downstream reliability discount/simulator blend ON TOP of
  // whatever calibration source fed into it (see `predictionEngine/index.ts`'s `generalProbability`
  // -> `blendedProbability` -> `preSimulatorProbability` chain) -- that happens identically
  // whether the calibration came from this override or the default shrink heuristic, so the
  // extreme 5%-flat override does not survive to the final number unchanged. What it DOES prove
  // (and is the actual thing this test needs to prove) is that the historically-active mapping
  // measurably pulled the final probability far below what the raw, uncalibrated favorite-side
  // probability says -- nowhere near it just mirroring rawProbability OR the 95%-flat mapping
  // that only became active after this match's cutoff.
  assert.ok(
    shadowRow.calibratedProbability! < shadowRow.rawProbability! - 30,
    `Expected the historically-active calibration to pull calibratedProbability well below rawProbability, got raw=${shadowRow.rawProbability} calibrated=${shadowRow.calibratedProbability}`,
  );
});
