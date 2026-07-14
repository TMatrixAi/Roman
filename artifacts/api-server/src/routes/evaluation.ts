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
  RunAblationAnalysisBody,
  RunAblationAnalysisResponse,
  GetAblationStatusResponse,
} from "@workspace/api-zod";
import { PAPER_TRADING_JOB_NAME } from "../jobs/paperTradingJobName";
import { CALIBRATION_REFIT_JOB_NAME } from "../jobs/calibrationRefitJobName";
import { runWalkForwardEvaluation } from "../services/evaluation/walkForward";
import { runPaperTradingCycle } from "../services/evaluation/paperTrading";
import { getPredictionSettings } from "../services/evaluation/settle";
import {
  computeSegmentMetrics,
  computeCalibrationBuckets,
  computeStreaks,
  computeUpsetRiskTierMetrics,
  computeDisagreementTierMetrics,
  computeMarketEdgeSummary,
} from "../services/evaluation/metrics";
import { computeEliteTierBacktest } from "../services/evaluation/eliteTierBacktest";
import { getActiveSpecialistSegments } from "../services/evaluation/specialistWeights";
import { validateAndStoreSimulator } from "../services/evaluation/simulatorValidation";
import { predictionSettingsTable, simulatorValidationTable } from "@workspace/db";
import { startAblationJob, getAblationJobStatus } from "../services/evaluation/ablationJob";
import { usedHistoricalMatchFallback } from "../services/predictionEngine/playerProfileWarnings";
import { runIncrementalHistoricalBackfill, getLatestCoveredMatchDate } from "../services/historicalData/backfill";
import { getTennisDataProvider } from "../services/tennisData";
import { HISTORICAL_BACKFILL_JOB_NAME } from "../jobs/historicalBackfillJobName";
import {
  RunHistoricalBackfillCycleResponse,
  ListHistoricalBackfillJobRunsQueryParams,
  ListHistoricalBackfillJobRunsResponse,
  GetHistoricalDataFreshnessResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Task #30: mirrors `withHistoricalMatchFallbackFlag` in `routes/predictions.ts` for evaluation
 * rows -- the real engine warnings live inside `featureSnapshot.engine.warnings` here (a free-form
 * JSONB blob, reduced-shape for historical_test rows and full `EngineBreakdown` for paper_trade/
 * live -- see `historicalScoring.ts`/`paperTrading.ts`), never a new guess.
 */
function withEvaluationHistoricalMatchFallbackFlag<T extends { featureSnapshot: unknown }>(
  row: T,
): T & { usedHistoricalMatchFallback: boolean } {
  const snapshot = row.featureSnapshot as { engine?: { warnings?: unknown } } | null;
  return { ...row, usedHistoricalMatchFallback: usedHistoricalMatchFallback(snapshot?.engine?.warnings) };
}

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

  res.json(ListEvaluationPredictionsResponse.parse(rows.map(withEvaluationHistoricalMatchFallbackFlag)));
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
  res.json(GetEvaluationPredictionResponse.parse(withEvaluationHistoricalMatchFallbackFlag(row)));
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

  // Task 46: Elite tier backtest, scoped to the SAME genuinely-unseen rows the dashboard already
  // separates out (historical_test test-segment + paper_trade/live) -- never the validation
  // segment, which was used to fit calibration.
  const eliteTierBacktest = computeEliteTierBacktest([...historicalTestRows, ...paperTradeRows]);

  // Task 56: disagreement/upset-risk are pure downstream classifiers of the already-calibrated
  // probability (see disagreement.ts/upsetRisk.ts) -- they cannot move accuracy/logLoss/Brier
  // themselves, so their validation is tier-level monotonicity, scoped to the same genuinely-
  // unseen rows the Elite tier backtest already uses (never the validation segment, which was
  // used to fit calibration).
  const unseenRows = [...historicalTestRows, ...paperTradeRows];
  const upsetRiskTierMetrics = computeUpsetRiskTierMetrics(unseenRows);
  const disagreementTierMetrics = computeDisagreementTierMetrics(unseenRows);

  // Task 47: rolling average market edge. Only paper_trade/live rows ever have real market odds
  // (historical_test replays past matches, for which no live odds source can honestly provide a
  // contemporaneous quote), so this is scoped to paper trading -- computeMarketEdgeSummary already
  // excludes rows with no edge value rather than treating them as 0.
  const marketEdge = computeMarketEdgeSummary(paperTradeRows);

  res.json(
    GetEvaluationDashboardResponse.parse({
      segments,
      activeCalibrationSampleSize: activeCalibration?.validationSampleSize ?? 0,
      activeCalibrationMethod: activeCalibration?.method ?? null,
      activeCalibrationIsotonicHoldoutLogLoss: activeCalibration?.isotonicHoldoutLogLoss ?? null,
      activeCalibrationPlattHoldoutLogLoss: activeCalibration?.plattHoldoutLogLoss ?? null,
      specialistSegments,
      eliteTierBacktest,
      upsetRiskTierMetrics,
      disagreementTierMetrics,
      marketEdge,
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

router.post("/evaluation/historical-backfill/run-cycle", async (_req, res): Promise<void> => {
  const provider = getTennisDataProvider();
  const result = await runIncrementalHistoricalBackfill(provider);
  res.json(RunHistoricalBackfillCycleResponse.parse(result));
});

router.get("/evaluation/historical-backfill/job-runs", async (req, res): Promise<void> => {
  const parsed = ListHistoricalBackfillJobRunsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db
    .select()
    .from(jobRunsTable)
    .where(eq(jobRunsTable.jobName, HISTORICAL_BACKFILL_JOB_NAME))
    .orderBy(desc(jobRunsTable.startedAt))
    .limit(parsed.data.limit);

  res.json(ListHistoricalBackfillJobRunsResponse.parse(rows));
});

router.get("/evaluation/historical-backfill/freshness", async (_req, res): Promise<void> => {
  const latestCoveredDate = await getLatestCoveredMatchDate();
  const asOf = new Date();
  let daysBehind: number | null = null;
  if (latestCoveredDate) {
    const todayUtc = asOf.toISOString().slice(0, 10);
    const msPerDay = 24 * 60 * 60 * 1000;
    daysBehind = Math.round((Date.parse(`${todayUtc}T00:00:00.000Z`) - Date.parse(`${latestCoveredDate}T00:00:00.000Z`)) / msPerDay);
  }
  res.json(GetHistoricalDataFreshnessResponse.parse({ latestCoveredDate, daysBehind, asOf: asOf.toISOString() }));
});

router.post("/evaluation/ablation/run", async (req, res): Promise<void> => {
  const parsed = RunAblationAnalysisBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = startAblationJob(parsed.data.sampleSize ?? undefined);
  res.json(RunAblationAnalysisResponse.parse(result));
});

router.get("/evaluation/ablation/status", async (_req, res): Promise<void> => {
  res.json(GetAblationStatusResponse.parse(getAblationJobStatus()));
});

export default router;
