import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
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
} from "@workspace/api-zod";
import { getTennisDataProvider, ProviderUnavailableError } from "../services/tennisData";
import { runPredictionEngine } from "../services/predictionEngine";
import { resolveOpponentStrength } from "../services/predictionEngine/opponentStrength";
import { resolveSegmentSpecialistInput } from "../services/evaluation/specialistWeights";

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
  const rows = await db.select().from(predictionsTable);

  const totalPredictions = rows.length;
  const resolved = rows.filter((r) => r.actualWinnerId !== null);
  const resolvedPredictions = resolved.length;
  const correctPredictions = resolved.filter((r) => r.actualWinnerId === r.predictedWinnerId).length;
  const accuracy = resolvedPredictions > 0 ? Math.round((correctPredictions / resolvedPredictions) * 1000) / 10 : null;

  const byRecommendationMap = new Map<string, number>();
  for (const row of rows) {
    byRecommendationMap.set(row.recommendation, (byRecommendationMap.get(row.recommendation) ?? 0) + 1);
  }

  res.json(
    GetPredictionStatsResponse.parse({
      totalPredictions,
      resolvedPredictions,
      correctPredictions,
      accuracy,
      byRecommendation: Array.from(byRecommendationMap.entries()).map(([recommendation, count]) => ({
        recommendation,
        count,
      })),
    }),
  );
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
    const [player1, player2] = await Promise.all([provider.getPlayer(body.player1Id), provider.getPlayer(body.player2Id)]);

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

    const [player1OpponentStrength, player2OpponentStrength, activeCalibrationRow, segment] = await Promise.all([
      resolveOpponentStrength(player1Matches),
      resolveOpponentStrength(player2Matches),
      db.select().from(calibrationModelsTable).where(eq(calibrationModelsTable.active, true)).limit(1),
      resolveSegmentSpecialistInput(matchTour, body.surface),
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
      segment,
    });

    const [saved] = await db
      .insert(predictionsTable)
      .values({
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
        dataQuality: output.dataQuality,
        dataQualityLabel: output.dataQualityLabel,
        upsetRisk: output.upsetRisk,
        recommendation: output.recommendation,
        predictedSetScore: output.predictedSetScore,
        engine: output.engine,
      })
      .returning();

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
