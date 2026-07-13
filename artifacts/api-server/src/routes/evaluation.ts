import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, evaluationPredictionsTable, evaluationRunsTable, calibrationModelsTable, jobRunsTable } from "@workspace/db";
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
  ListPaperTradingJobRunsQueryParams,
  ListPaperTradingJobRunsResponse,
  ListCalibrationRefitJobRunsQueryParams,
  ListCalibrationRefitJobRunsResponse,
  GetSimulatorValidationResponse,
  RunAblationAnalysisResponse,
  GetAblationStatusResponse,
} from "@workspace/api-zod";
import { PAPER_TRADING_JOB_NAME } from "../jobs/paperTradingJobName";
import { CALIBRATION_REFIT_JOB_NAME } from "../jobs/calibrationRefitJobName";
import { runWalkForwardEvaluation } from "../services/evaluation/walkForward";
import { runPaperTradingCycle } from "../services/evaluation/paperTrading";
import { getPredictionSettings } from "../services/evaluation/settle";
import { computeSegmentMetrics, computeCalibrationBuckets, computeStreaks } from "../services/evaluation/metrics";
import { getActiveSpecialistSegments } from "../services/evaluation/specialistWeights";
import { validateAndStoreSimulator } from "../services/evaluation/simulatorValidation";
import { predictionSettingsTable, simulatorValidationTable } from "@workspace/db";
import { startAblationJob, getAblationJobStatus } from "../services/evaluation/ablationJob";

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
  // Each segment is fetched with its own indexed WHERE (runKind [+ segment]) instead of loading
  // the entire evaluation_predictions table into Node and filtering in JS -- same three segments,
  // same rows per segment, but the query no longer scales with total table size.
  const [historicalValidationRows, historicalTestRows, paperTradeRows] = await Promise.all([
    db
      .select()
      .from(evaluationPredictionsTable)
      .where(and(eq(evaluationPredictionsTable.runKind, "historical_test"), eq(evaluationPredictionsTable.segment, "validation"))),
    db
      .select()
      .from(evaluationPredictionsTable)
      .where(and(eq(evaluationPredictionsTable.runKind, "historical_test"), eq(evaluationPredictionsTable.segment, "test"))),
    db
      .select()
      .from(evaluationPredictionsTable)
      .where(inArray(evaluationPredictionsTable.runKind, ["paper_trade", "live"])),
  ]);

  const segmentDefs = [
    {
      key: "historical_validation",
      label: "Historical Test — Validation (used to fit calibration)",
      isGenuinelyUnseen: false,
      rows: historicalValidationRows,
    },
    {
      key: "historical_test",
      label: "Historical Test — Test (never used for tuning)",
      isGenuinelyUnseen: true,
      rows: historicalTestRows,
    },
    {
      key: "paper_trade",
      label: "Live Paper Trading (real upcoming fixtures)",
      isGenuinelyUnseen: true,
      rows: paperTradeRows,
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
  const specialistSegments = await getActiveSpecialistSegments();

  res.json(
    GetEvaluationDashboardResponse.parse({
      segments,
      activeCalibrationSampleSize: activeCalibration?.validationSampleSize ?? 0,
      specialistSegments,
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

router.get("/evaluation/simulator", async (_req, res): Promise<void> => {
  const [row] = await db.select().from(simulatorValidationTable).limit(1);
  if (!row) {
    res.json(
      GetSimulatorValidationResponse.parse({
        sampleSize: 0,
        minSampleSize: 30,
        simulatorAccuracy: null,
        simulatorLogLoss: null,
        simulatorBrier: null,
        ensembleAccuracy: null,
        ensembleLogLoss: null,
        ensembleBrier: null,
        adopted: false,
        weight: 0,
        note: "No validation run has completed yet -- POST /api/evaluation/simulator/validate to compute one from real graded outcomes.",
        computedAt: null,
      }),
    );
    return;
  }
  res.json(GetSimulatorValidationResponse.parse(row));
});

router.post("/evaluation/simulator/validate", async (_req, res): Promise<void> => {
  const summary = await validateAndStoreSimulator();
  res.json(
    GetSimulatorValidationResponse.parse({
      ...summary,
      computedAt: new Date().toISOString(),
    }),
  );
});

router.post("/paper-trading/run-cycle", async (_req, res): Promise<void> => {
  const summary = await runPaperTradingCycle();
  res.json(RunPaperTradingCycleResponse.parse(summary));
});

router.get("/paper-trading/job-runs", async (req, res): Promise<void> => {
  const parsed = ListPaperTradingJobRunsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db
    .select()
    .from(jobRunsTable)
    .where(eq(jobRunsTable.jobName, PAPER_TRADING_JOB_NAME))
    .orderBy(desc(jobRunsTable.startedAt))
    .limit(parsed.data.limit);

  res.json(ListPaperTradingJobRunsResponse.parse(rows));
});

router.get("/evaluation/calibration-refit/job-runs", async (req, res): Promise<void> => {
  const parsed = ListCalibrationRefitJobRunsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db
    .select()
    .from(jobRunsTable)
    .where(eq(jobRunsTable.jobName, CALIBRATION_REFIT_JOB_NAME))
    .orderBy(desc(jobRunsTable.startedAt))
    .limit(parsed.data.limit);

  res.json(ListCalibrationRefitJobRunsResponse.parse(rows));
});

router.post("/evaluation/ablation/run", async (_req, res): Promise<void> => {
  const result = startAblationJob();
  res.json(RunAblationAnalysisResponse.parse(result));
});

router.get("/evaluation/ablation/status", async (_req, res): Promise<void> => {
  res.json(GetAblationStatusResponse.parse(getAblationJobStatus()));
});

export default router;
