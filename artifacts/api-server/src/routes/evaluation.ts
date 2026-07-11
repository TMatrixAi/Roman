import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, evaluationPredictionsTable, evaluationRunsTable, calibrationModelsTable } from "@workspace/db";
import {
  ListEvaluationPredictionsQueryParams,
  ListEvaluationPredictionsResponse,
  GetEvaluationPredictionParams,
  GetEvaluationPredictionResponse,
  ListEvaluationRunsResponse,
  RunWalkForwardBody,
  RunWalkForwardResponse,
  GetEvaluationDashboardResponse,
  GetEvaluationSettingsResponse,
  UpdateEvaluationSettingsBody,
  UpdateEvaluationSettingsResponse,
  RunPaperTradingCycleResponse,
} from "@workspace/api-zod";
import { runWalkForwardEvaluation } from "../services/evaluation/walkForward";
import { runPaperTradingCycle } from "../services/evaluation/paperTrading";
import { getPredictionSettings } from "../services/evaluation/settle";
import { computeSegmentMetrics, computeCalibrationBuckets, computeStreaks } from "../services/evaluation/metrics";
import { predictionSettingsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/evaluation/runs", async (_req, res): Promise<void> => {
  const rows = await db.select().from(evaluationRunsTable).orderBy(desc(evaluationRunsTable.foldIndex));
  res.json(ListEvaluationRunsResponse.parse(rows));
});

router.post("/evaluation/walk-forward/run", async (req, res): Promise<void> => {
  const parsed = RunWalkForwardBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const summary = await runWalkForwardEvaluation(parsed.data);
  res.json(RunWalkForwardResponse.parse(summary));
});

router.get("/evaluation/predictions", async (req, res): Promise<void> => {
  const parsed = ListEvaluationPredictionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { runKind, segment, status, limit } = parsed.data;

  const conditions = [];
  if (runKind) conditions.push(eq(evaluationPredictionsTable.runKind, runKind));
  if (segment) conditions.push(eq(evaluationPredictionsTable.segment, segment));
  if (status) conditions.push(eq(evaluationPredictionsTable.status, status));

  const rows = await db
    .select()
    .from(evaluationPredictionsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(evaluationPredictionsTable.scheduledStartAt))
    .limit(limit);

  res.json(ListEvaluationPredictionsResponse.parse(rows));
});

router.get("/evaluation/predictions/:predictionId", async (req, res): Promise<void> => {
  const params = GetEvaluationPredictionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db.select().from(evaluationPredictionsTable).where(eq(evaluationPredictionsTable.id, params.data.predictionId));
  if (!row) {
    res.status(404).json({ error: "Evaluation prediction not found" });
    return;
  }
  res.json(GetEvaluationPredictionResponse.parse(row));
});

router.get("/evaluation/dashboard", async (_req, res): Promise<void> => {
  const allRows = await db.select().from(evaluationPredictionsTable);

  const segmentDefs: Array<{ key: string; label: string; isGenuinelyUnseen: boolean; rows: typeof allRows }> = [
    {
      key: "historical_validation",
      label: "Historical Test — Validation (used to fit calibration)",
      isGenuinelyUnseen: false,
      rows: allRows.filter((r) => r.runKind === "historical_test" && r.segment === "validation"),
    },
    {
      key: "historical_test",
      label: "Historical Test — Test (never used for tuning)",
      isGenuinelyUnseen: true,
      rows: allRows.filter((r) => r.runKind === "historical_test" && r.segment === "test"),
    },
    {
      key: "paper_trade",
      label: "Live Paper Trading (real upcoming fixtures)",
      isGenuinelyUnseen: true,
      rows: allRows.filter((r) => r.runKind === "paper_trade" || r.runKind === "live"),
    },
  ];

  const segments = segmentDefs.map((def) => ({
    key: def.key,
    label: def.label,
    isGenuinelyUnseen: def.isGenuinelyUnseen,
    metrics: computeSegmentMetrics(def.rows),
    calibrationBuckets: computeCalibrationBuckets(def.rows),
    streaks: computeStreaks(def.rows),
  }));

  const [activeCalibration] = await db.select().from(calibrationModelsTable).where(eq(calibrationModelsTable.active, true)).limit(1);

  res.json(
    GetEvaluationDashboardResponse.parse({
      segments,
      activeCalibrationSampleSize: activeCalibration?.validationSampleSize ?? 0,
    }),
  );
});

router.get("/evaluation/settings", async (_req, res): Promise<void> => {
  const settings = await getPredictionSettings();
  res.json(GetEvaluationSettingsResponse.parse(settings));
});

router.patch("/evaluation/settings", async (req, res): Promise<void> => {
  const parsed = UpdateEvaluationSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const current = await getPredictionSettings();
  const [updated] = await db
    .update(predictionSettingsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(predictionSettingsTable.id, current.id))
    .returning();

  res.json(UpdateEvaluationSettingsResponse.parse(updated));
});

router.post("/paper-trading/run-cycle", async (_req, res): Promise<void> => {
  const summary = await runPaperTradingCycle();
  res.json(RunPaperTradingCycleResponse.parse(summary));
});

export default router;
