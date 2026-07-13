import { Router, type IRouter } from "express";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { db, predictionsTable, calibrationModelsTable } from "@workspace/db";
import {
  ListPredictionsQueryParams,
  ListPredictionsResponse,
  CreatePredictionBody,
  CreatePredictionResponse,
  GetPredictionStatsResponse,
  GetPredictionParams,
  GetPredictionResponse,
  RecordPredictionOutcomeParams,
  RecordPredictionOutcomeBody,
  RecordPredictionOutcomeResponse,
  DeletePredictionParams,
  BulkDeletePredictionsBody,
  BulkDeletePredictionsResponse,
  GradePendingLedgerPredictionsResponse,
  PreviewDuplicatePredictionsResponse,
  RemoveDuplicatePredictionsResponse,
  SearchLedgerPlayersQueryParams,
  SearchLedgerPlayersResponse,
  GetLedgerPlayerPredictionsParams,
  GetLedgerPlayerPredictionsResponse,
} from "@workspace/api-zod";
import { getTennisDataProvider, ProviderUnavailableError } from "../services/tennisData";
import { resolvePlayerProfile } from "../services/tennisData/playerIdentity";
import { runPredictionEngine } from "../services/predictionEngine";
import { buildPlayerProfileWarnings } from "../services/predictionEngine/playerProfileWarnings";
import { resolveOpponentStrength } from "../services/predictionEngine/opponentStrength";
import { computeMatchIdentityKey, computeInputSnapshotHash } from "../services/predictionEngine/predictionIdentity";
import { resolveSegmentSpecialistInput } from "../services/evaluation/specialistWeights";
import { resolveSimulatorAdoption } from "../services/evaluation/simulatorValidation";
import { gradePendingLedgerPredictions } from "../services/evaluation/ledgerGrading";
import { findDuplicatePredictionGroups, removeDuplicatePredictions } from "../services/evaluation/ledgerDuplicates";
import { searchLedgerPlayers, getPredictionsForPlayer } from "../services/evaluation/ledgerPlayers";
import { saveOrUpdatePrediction } from "../services/evaluation/savePrediction";

const router: IRouter = Router();

router.get("/predictions", async (req, res): Promise<void> => {
  const parsed = ListPredictionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db
    .select()
    .from(predictionsTable)
    .orderBy(desc(predictionsTable.createdAt))
    .limit(parsed.data.limit);

  res.json(ListPredictionsResponse.parse(rows));
});

router.get("/predictions/stats", async (_req, res): Promise<void> => {
  // Aggregated in SQL rather than loading every row into Node -- same output shape as before,
  // but the endpoint no longer scales linearly with total prediction count.
  const [totals] = await db
    .select({
      totalPredictions: sql<number>`count(*)`.mapWith(Number),
      resolvedPredictions: sql<number>`count(*) filter (where ${predictionsTable.actualWinnerId} is not null)`.mapWith(Number),
      correctPredictions: sql<number>`count(*) filter (where ${predictionsTable.actualWinnerId} = ${predictionsTable.predictedWinnerId})`.mapWith(
        Number,
      ),
    })
    .from(predictionsTable);

  const byRecommendationRows = await db
    .select({
      recommendation: predictionsTable.recommendation,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(predictionsTable)
    .groupBy(predictionsTable.recommendation);

  const { totalPredictions, resolvedPredictions, correctPredictions } = totals ?? {
    totalPredictions: 0,
    resolvedPredictions: 0,
    correctPredictions: 0,
  };
  const accuracy = resolvedPredictions > 0 ? Math.round((correctPredictions / resolvedPredictions) * 1000) / 10 : null;

  res.json(
    GetPredictionStatsResponse.parse({
      totalPredictions,
      resolvedPredictions,
      correctPredictions,
      accuracy,
      byRecommendation: byRecommendationRows,
    }),
  );
});

// Registered before /predictions/:predictionId and /predictions/players/:playerId so that
// "/predictions/players/search" resolves as this literal route rather than being swallowed by
// the :playerId param route below.
router.get("/predictions/players/search", async (req, res): Promise<void> => {
  const parsed = SearchLedgerPlayersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const players = await searchLedgerPlayers(parsed.data.query);
  res.json(SearchLedgerPlayersResponse.parse(players));
});

router.get("/predictions/players/:playerId", async (req, res): Promise<void> => {
  const params = GetLedgerPlayerPredictionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await getPredictionsForPlayer(params.data.playerId);
  res.json(GetLedgerPlayerPredictionsResponse.parse(rows));
});

router.post("/predictions", async (req, res): Promise<void> => {
  const parsed = CreatePredictionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  if (body.player1Id === body.player2Id) {
    res.status(400).json({ error: "player1Id and player2Id must be different players" });
    return;
  }

  const provider = getTennisDataProvider();

  try {
    const [player1, player2] = await Promise.all([
      resolvePlayerProfile(provider, body.player1Id),
      resolvePlayerProfile(provider, body.player2Id),
    ]);

    if (!player1 || !player2) {
      res.status(400).json({ error: "One or both players could not be found by the data provider" });
      return;
    }

    const [player1Matches, player2Matches, headToHead] = await Promise.all([
      provider.getPlayerMatches(body.player1Id),
      provider.getPlayerMatches(body.player2Id),
      provider.getHeadToHead(body.player1Id, body.player2Id),
    ]);

    // Tour isn't part of the request -- it's read off the player profiles themselves (both
    // players are on the same tour for any real fixture; player1's is preferred, player2's used
    // only if player1's happens to be unknown).
    const matchTour = player1.tour ?? player2.tour;

    const [player1OpponentStrength, player2OpponentStrength, activeCalibrationRow, segment, simulatorAdoption] = await Promise.all([
      resolveOpponentStrength(player1Matches),
      resolveOpponentStrength(player2Matches),
      db.select().from(calibrationModelsTable).where(eq(calibrationModelsTable.active, true)).limit(1),
      resolveSegmentSpecialistInput(matchTour, body.surface),
      resolveSimulatorAdoption(),
    ]);

    const output = runPredictionEngine({
      player1,
      player2,
      player1Matches,
      player2Matches,
      headToHead,
      surface: body.surface,
      matchFormat: body.matchFormat,
      player1OpponentElo: player1OpponentStrength.lookup,
      player2OpponentElo: player2OpponentStrength.lookup,
      activeCalibration: activeCalibrationRow[0]?.mapping ?? null,
      // No scheduled fixture date is known for an ad-hoc prediction request, so weather is
      // intentionally omitted here -- see paperTrading.ts for genuinely upcoming fixtures.
      weather: null,
      tournamentName: body.tournamentName ?? null,
      tournamentLevel: body.tournamentLevel ?? null,
      segment,
      simulatorAdoption,
    });
    output.engine.warnings.push(...buildPlayerProfileWarnings(player1, player2));

    const matchIdentityKey = computeMatchIdentityKey(player1.id, player2.id, body.tournamentName ?? null, body.surface, body.matchFormat);
    const inputSnapshotHash = computeInputSnapshotHash({
      player1Id: player1.id,
      player2Id: player2.id,
      player1Matches,
      player2Matches,
      headToHead,
      player1OpponentElo: player1OpponentStrength.lookup,
      player2OpponentElo: player2OpponentStrength.lookup,
    });

    const saved = await saveOrUpdatePrediction({
      player1Id: player1.id,
      player1Name: player1.name,
      player2Id: player2.id,
      player2Name: player2.name,
      surface: body.surface,
      matchFormat: body.matchFormat,
      tournamentLevel: body.tournamentLevel ?? null,
      tournamentName: body.tournamentName ?? null,
      predictedWinnerId: output.predictedWinnerId,
      predictedWinnerName: output.predictedWinnerName,
      calibratedProbability: output.calibratedProbability,
      predictedWinnerProbability: output.predictedWinnerProbability,
      dataQuality: output.dataQuality,
      dataQualityLabel: output.dataQualityLabel,
      upsetRisk: output.upsetRisk,
      recommendation: output.recommendation,
      predictedSetScore: output.predictedSetScore,
      engine: output.engine,
      matchIdentityKey,
      inputSnapshotHash,
    });

    res.status(201).json(CreatePredictionResponse.parse(saved));
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      res.status(502).json({ error: "Tennis data provider unavailable", detail: err.message });
      return;
    }
    throw err;
  }
});

router.get("/predictions/:predictionId", async (req, res): Promise<void> => {
  const params = GetPredictionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db.select().from(predictionsTable).where(eq(predictionsTable.id, params.data.predictionId));

  if (!row) {
    res.status(404).json({ error: "Prediction not found" });
    return;
  }

  res.json(GetPredictionResponse.parse(row));
});

router.delete("/predictions/:predictionId", async (req, res): Promise<void> => {
  const params = DeletePredictionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const deleted = await db
    .delete(predictionsTable)
    .where(eq(predictionsTable.id, params.data.predictionId))
    .returning({ id: predictionsTable.id });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Prediction not found" });
    return;
  }

  res.status(204).end();
});

router.post("/predictions/bulk-delete", async (req, res): Promise<void> => {
  const parsed = BulkDeletePredictionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const deleted = await db
    .delete(predictionsTable)
    .where(inArray(predictionsTable.id, parsed.data.ids))
    .returning({ id: predictionsTable.id });

  res.json(BulkDeletePredictionsResponse.parse({ deletedCount: deleted.length }));
});

router.post("/predictions/duplicates/preview", async (_req, res): Promise<void> => {
  const groups = await findDuplicatePredictionGroups();
  const removableCount = groups.reduce((sum, g) => sum + g.removeIds.length, 0);
  res.json(PreviewDuplicatePredictionsResponse.parse({ removableCount, groups }));
});

router.post("/predictions/duplicates/remove", async (_req, res): Promise<void> => {
  const { removedCount, groups } = await removeDuplicatePredictions();
  res.json(RemoveDuplicatePredictionsResponse.parse({ removedCount, groups }));
});

router.post("/predictions/grade-pending", async (_req, res): Promise<void> => {
  try {
    const summary = await gradePendingLedgerPredictions();
    res.json(GradePendingLedgerPredictionsResponse.parse(summary));
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      res.status(502).json({ error: "Tennis data provider unavailable", detail: err.message });
      return;
    }
    throw err;
  }
});

router.patch("/predictions/:predictionId/outcome", async (req, res): Promise<void> => {
  const params = RecordPredictionOutcomeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = RecordPredictionOutcomeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db.select().from(predictionsTable).where(eq(predictionsTable.id, params.data.predictionId));
  if (!existing) {
    res.status(404).json({ error: "Prediction not found" });
    return;
  }

  const actualWinnerName =
    body.data.actualWinnerId === existing.player1Id
      ? existing.player1Name
      : body.data.actualWinnerId === existing.player2Id
        ? existing.player2Name
        : null;

  const [updated] = await db
    .update(predictionsTable)
    .set({
      actualWinnerId: body.data.actualWinnerId,
      actualWinnerName,
      resolvedAt: new Date(),
    })
    .where(eq(predictionsTable.id, params.data.predictionId))
    .returning();

  res.json(GetPredictionResponse.parse(updated));
});

export default router;
