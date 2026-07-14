// Unit test for the Phase 6 specialist-segment weighting logic. Seeds a synthetic tour/surface
// segment with enough real historical matches and validation-segment predictions to clear both
// data-sufficiency thresholds, and a second segment deliberately left thin, then verifies:
// (1) the thin segment falls back to the general model with meetsThreshold=false and weight=0,
// (2) the well-populated segment fits its own calibration and is measured against the general
//     mapping on the SAME points, and (3) `resolveSegmentSpecialistInput` surfaces the right
//     caller-facing shape either way, and null for a tour Phase 6 doesn't consider a candidate.
// Run with: pnpm --filter @workspace/api-server run test:evaluation
import test from "node:test";
import assert from "node:assert/strict";
import { db, historicalMatchesTable, evaluationPredictionsTable, specialistModelsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  computeAndStoreSpecialistSegments,
  resolveSegmentSpecialistInput,
  MIN_HISTORICAL_MATCHES_FOR_SEGMENT,
  MIN_VALIDATION_SAMPLES_FOR_SEGMENT,
} from "./specialistWeights";

const PROVIDER = "specialist-weights-test";
const RICH_TOUR = "ATP";
const RICH_SURFACE = "Clay" as const;
// The "thin" segment must actually stay below `MIN_HISTORICAL_MATCHES_FOR_SEGMENT` in the real
// table. A hardcoded WTA/Grass choice broke once real backfilled data grew that segment past 150
// matches (see `.agents/memory/test-isolation-against-live-tables.md`) -- picked dynamically
// below instead, from whichever real candidate segment currently has the fewest matches.
const CANDIDATE_TOURS = ["ATP", "WTA"] as const;
const CANDIDATE_SURFACES = ["Hard", "Clay", "Grass", "IndoorHard"] as const;

function makeHistoricalMatch(i: number, tour: string, surface: "Hard" | "Clay" | "Grass" | "IndoorHard", player1: string, player2: string, winner: string) {
  const scheduledStartAt = new Date(Date.UTC(2019, 0, 1 + i, 12, 0, 0));
  const cutoffAt = new Date(scheduledStartAt.getTime() - 30 * 60_000);
  return {
    externalId: `${PROVIDER}-${tour}-${surface}-${i}`,
    provider: PROVIDER,
    tour,
    tournamentName: "Specialist Weights Test Series",
    tournamentLevel: null,
    surface,
    round: null,
    matchFormat: "BestOf3" as const,
    player1Id: player1,
    player1Name: player1,
    player2Id: player2,
    player2Name: player2,
    winnerId: winner,
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

test("Phase 6 specialist weighting: rich segment gets its own calibration, thin segment falls back honestly", async (t) => {
  // `historicalMatchCount` is a real, live count of ALL historical matches for a tour+surface
  // (see `computeOneSegment`) -- it is NOT scoped to this test's own inserted rows. A real backfill
  // (manual, or the recurring calibration-refit job) may have already populated real ATP-Clay /
  // WTA-Grass matches by the time this test runs, so expectations must be relative to whatever
  // pre-existing count is really in the table, never a hardcoded assumption that it starts at 0.
  const [{ count: preexistingRich }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(historicalMatchesTable)
    .where(and(eq(historicalMatchesTable.tour, RICH_TOUR), eq(historicalMatchesTable.surface, RICH_SURFACE)));
  // Pick whichever real candidate tour/surface segment (excluding the rich one above, so the two
  // never collide) currently has the fewest real historical matches, and use that as "thin" --
  // never a hardcoded pair, since real backfilled data keeps growing every segment over time.
  const candidateCounts = await Promise.all(
    CANDIDATE_TOURS.flatMap((tour) =>
      CANDIDATE_SURFACES.filter((surface) => !(tour === RICH_TOUR && surface === RICH_SURFACE)).map(async (surface) => {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(historicalMatchesTable)
          .where(and(eq(historicalMatchesTable.tour, tour), eq(historicalMatchesTable.surface, surface)));
        return { tour, surface, count };
      }),
    ),
  );
  const thinnest = candidateCounts.reduce((min, c) => (c.count < min.count ? c : min));
  const THIN_TOUR = thinnest.tour;
  const THIN_SURFACE = thinnest.surface;
  const preexistingThin = thinnest.count;
  const thinMatchCount = 5; // deliberately far under threshold, on top of whatever real data already exists
  if (preexistingThin + thinMatchCount >= MIN_HISTORICAL_MATCHES_FOR_SEGMENT) {
    t.skip(
      `Every real candidate segment already has >= ${MIN_HISTORICAL_MATCHES_FOR_SEGMENT - thinMatchCount} historical matches (thinnest: ${THIN_TOUR}-${THIN_SURFACE} at ${preexistingThin}) -- no segment can genuinely stay "thin" for this test right now.`,
    );
    return;
  }

  // Same real-data caveat applies to validation-segment `evaluation_predictions` rows (e.g. from a
  // real, already-run walk-forward evaluation) -- count what's already there for this exact
  // tour+surface before adding the test's own synthetic validation rows.
  const [{ count: preexistingRichValidation }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(evaluationPredictionsTable)
    .innerJoin(historicalMatchesTable, eq(evaluationPredictionsTable.historicalMatchId, historicalMatchesTable.id))
    .where(
      and(
        eq(evaluationPredictionsTable.runKind, "historical_test"),
        eq(evaluationPredictionsTable.segment, "validation"),
        eq(evaluationPredictionsTable.includedInAccuracy, true),
        eq(historicalMatchesTable.tour, RICH_TOUR),
        eq(historicalMatchesTable.surface, RICH_SURFACE),
      ),
    );

  const richMatchCount = MIN_HISTORICAL_MATCHES_FOR_SEGMENT + 10;
  const richValidationCount = MIN_VALIDATION_SAMPLES_FOR_SEGMENT + 10;

  const richMatches = Array.from({ length: richMatchCount }, (_, i) =>
    makeHistoricalMatch(i, RICH_TOUR, RICH_SURFACE, `rich-p1`, `rich-p2`, i % 2 === 0 ? "rich-p1" : "rich-p2"),
  );
  const thinMatches = Array.from({ length: thinMatchCount }, (_, i) =>
    makeHistoricalMatch(i, THIN_TOUR, THIN_SURFACE, `thin-p1`, `thin-p2`, "thin-p1"),
  );

  const insertedRich = await db.insert(historicalMatchesTable).values(richMatches).returning({ id: historicalMatchesTable.id });
  const insertedThin = await db.insert(historicalMatchesTable).values(thinMatches).returning({ id: historicalMatchesTable.id });

  // Seed validation-segment evaluation_predictions for the rich segment only, with rawProbability
  // genuinely informative (favorite wins more often than not) so the segment-only fit produces a
  // real, non-identity calibration curve distinct from a naive general mapping.
  const richPredictionRows = insertedRich.slice(0, richValidationCount).map((row, i) => {
    const player1Won = i % 3 !== 0; // player1 wins ~2/3 of the time
    const rawProbability = player1Won ? 65 : 35; // raw model already leans the right way, imperfectly
    return {
      runKind: "historical_test",
      segment: "validation" as const,
      historicalMatchId: row.id,
      player1Id: "rich-p1",
      player1Name: "rich-p1",
      player2Id: "rich-p2",
      player2Name: "rich-p2",
      surface: RICH_SURFACE,
      matchFormat: "BestOf3",
      scheduledStartAt: new Date(),
      cutoffAt: new Date(),
      modelVersion: "test",
      rawProbability,
      calibratedProbability: rawProbability,
      predictedWinnerId: player1Won ? "rich-p1" : "rich-p2",
      status: "graded",
      actualWinnerId: player1Won ? "rich-p1" : "rich-p2",
      resultType: "normal",
      includedInAccuracy: true,
    };
  });
  await db.insert(evaluationPredictionsTable).values(richPredictionRows);

  t.after(async () => {
    await db.delete(evaluationPredictionsTable).where(inArray(evaluationPredictionsTable.historicalMatchId, insertedRich.map((r) => r.id)));
    await db.delete(historicalMatchesTable).where(inArray(historicalMatchesTable.id, [...insertedRich.map((r) => r.id), ...insertedThin.map((r) => r.id)]));
    await db.delete(specialistModelsTable);
  });

  // A deliberately naive, uninformative "general" mapping (identity) so the rich segment's fit
  // (which sees the real 65/35 split) should measurably beat it.
  const generalMapping = [
    { x: 0, y: 0.5 },
    { x: 1, y: 0.5 },
  ];

  const results = await computeAndStoreSpecialistSegments(generalMapping);
  const richResult = results.find((r) => r.segmentKey === `${RICH_TOUR}-${RICH_SURFACE}`);
  const thinResult = results.find((r) => r.segmentKey === `${THIN_TOUR}-${THIN_SURFACE}`);

  assert.ok(richResult, "Expected a persisted row for the rich segment");
  assert.ok(thinResult, "Expected a persisted row for the thin segment");

  // Thin segment: honest fallback, never silently fit.
  assert.equal(thinResult!.meetsThreshold, false);
  assert.equal(thinResult!.weight, 0);
  assert.equal(thinResult!.historicalMatchCount, preexistingThin + thinMatchCount);

  // Rich segment: cleared both thresholds, fit its own mapping, and measurably beats the naive
  // identity general mapping on the same points (lower logLoss = better).
  assert.equal(richResult!.meetsThreshold, true);
  assert.equal(richResult!.historicalMatchCount, preexistingRich + richMatchCount);
  assert.equal(richResult!.validationSampleSize, preexistingRichValidation + richValidationCount);
  assert.ok(richResult!.logLoss !== null && richResult!.generalLogLoss !== null);
  assert.ok(richResult!.logLoss! < richResult!.generalLogLoss!, "Segment-fit calibration should beat the naive general mapping on its own data");
  assert.ok(richResult!.weight > 0.1 && richResult!.weight <= 0.85, `Weight ${richResult!.weight} should be within the documented [0.1, 0.85] blend range`);

  // Caller-facing resolver surfaces the same status for both segments, and null for a
  // non-candidate tour (Challenger isn't ATP/WTA).
  const richInput = await resolveSegmentSpecialistInput(RICH_TOUR, RICH_SURFACE);
  assert.ok(richInput?.meetsThreshold);
  assert.ok(richInput?.calibrationMapping && richInput.calibrationMapping.length > 0);

  const thinInput = await resolveSegmentSpecialistInput(THIN_TOUR, THIN_SURFACE);
  assert.equal(thinInput?.meetsThreshold, false);
  assert.equal(thinInput?.calibrationMapping, undefined);

  const nonCandidateInput = await resolveSegmentSpecialistInput("Challenger", RICH_SURFACE);
  assert.equal(nonCandidateInput, null);
});
