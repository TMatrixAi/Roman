import { Router, type IRouter } from "express";
import { db, backtestRunsTable, backtestPredictionsTable, candidateConfigsTable, configPromotionsTable } from "@workspace/db";
import { desc, eq, isNull, and, asc, sql } from "drizzle-orm";
import { runEvaluationBacktest, previewBacktest, type BacktestFilters, type BacktestDateRange } from "../services/evaluation/backtestService";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Active runs tracking (in-process, for single-server dev) ─────────────

const activeRuns = new Map<number, Promise<void>>();

// ─── Manual validation helpers ────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDateRange(obj: unknown): { ok: true; value: BacktestDateRange } | { ok: false; error: string } {
  if (typeof obj !== "object" || obj === null) return { ok: false, error: "dateRange must be an object" };
  const { start, end } = obj as Record<string, unknown>;
  if (typeof start !== "string" || !DATE_RE.test(start)) return { ok: false, error: "dateRange.start must be YYYY-MM-DD" };
  if (typeof end !== "string" || !DATE_RE.test(end)) return { ok: false, error: "dateRange.end must be YYYY-MM-DD" };
  return { ok: true, value: { start, end } };
}

function parseFilters(obj: unknown): BacktestFilters {
  if (typeof obj !== "object" || obj === null) return {};
  const f = obj as Record<string, unknown>;
  return {
    surface: typeof f.surface === "string" ? f.surface : undefined,
    tour: typeof f.tour === "string" ? f.tour : undefined,
    tournamentLevel: typeof f.tournamentLevel === "string" ? f.tournamentLevel : undefined,
    bestOf: typeof f.bestOf === "number" ? f.bestOf : undefined,
    includeRetirements: typeof f.includeRetirements === "boolean" ? f.includeRetirements : undefined,
    includeWalkovers: typeof f.includeWalkovers === "boolean" ? f.includeWalkovers : undefined,
    minCalibrated: typeof f.minCalibrated === "number" ? f.minCalibrated : undefined,
    maxCalibrated: typeof f.maxCalibrated === "number" ? f.maxCalibrated : undefined,
  };
}

function parseIntQ(val: unknown, defaultVal: number, min = 0, max = Infinity): number {
  const n = typeof val === "string" ? parseInt(val, 10) : typeof val === "number" ? val : defaultVal;
  if (isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(max, n));
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/** Preview: how many rows would a set of filters capture? */
router.post("/backtests/preview", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  const dateRangeResult = validateDateRange(body.dateRange);
  if (!dateRangeResult.ok) { res.status(400).json({ error: dateRangeResult.error }); return; }
  try {
    const preview = await previewBacktest(dateRangeResult.value, parseFilters(body.filters));
    res.json(preview);
  } catch (err) {
    logger.error({ err }, "Backtest preview failed");
    res.status(500).json({ error: "Preview failed" });
  }
});

/** Create a new backtest run and start it in the background */
router.post("/backtests", async (req, res): Promise<void> => {
  const body = req.body ?? {};

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 200) { res.status(400).json({ error: "name must be 1–200 characters" }); return; }

  const mode = body.mode === "optimization" ? "optimization" : "evaluation";
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : undefined;

  const dateRangeResult = validateDateRange(body.dateRange);
  if (!dateRangeResult.ok) { res.status(400).json({ error: dateRangeResult.error }); return; }
  const dateRange = dateRangeResult.value;

  if (dateRange.start > dateRange.end) { res.status(400).json({ error: "start date must be before end date" }); return; }

  const filters = parseFilters(body.filters);

  const [inserted] = await db
    .insert(backtestRunsTable)
    .values({
      name,
      notes: notes ?? null,
      status: "queued",
      mode,
      dateRange,
      filters: filters as Record<string, unknown>,
      modelVersion: "1.0",
      datasetVersion: new Date().toISOString().slice(0, 10),
    })
    .returning();

  // Fire-and-forget in the background — client polls for progress
  const runPromise = runEvaluationBacktest({
    runId: inserted.id,
    dateRange,
    filters,
    mode,
  })
    .then(async () => {
      if (mode === "optimization") {
        // Training mode: mark with a warning since optimizer not yet available
        const [current] = await db.select({ status: backtestRunsTable.status }).from(backtestRunsTable).where(eq(backtestRunsTable.id, inserted.id));
        if (current?.status === "completed") {
          await db
            .update(backtestRunsTable)
            .set({ currentStage: "Training mode: executed as evaluation-only (optimizer service pending)" })
            .where(eq(backtestRunsTable.id, inserted.id));
        }
      }
    })
    .catch((err) => {
      logger.error({ err, runId: inserted.id }, "Backtest run error (background)");
    });

  activeRuns.set(inserted.id, runPromise);
  runPromise.finally(() => activeRuns.delete(inserted.id));

  res.status(202).json(inserted);
});

/** List all runs (non-deleted), newest first */
router.get("/backtests", async (req, res): Promise<void> => {
  const limit = parseIntQ(req.query.limit, 50, 1, 100);
  const offset = parseIntQ(req.query.offset, 0, 0);

  const rows = await db
    .select()
    .from(backtestRunsTable)
    .where(isNull(backtestRunsTable.deletedAt))
    .orderBy(desc(backtestRunsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(rows);
});

/** Get a single run by ID */
router.get("/backtests/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [row] = await db.select().from(backtestRunsTable).where(and(eq(backtestRunsTable.id, id), isNull(backtestRunsTable.deletedAt)));
  if (!row) { res.status(404).json({ error: "not found" }); return; }

  res.json(row);
});

/** Cancel a running backtest */
router.post("/backtests/:id/cancel", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [row] = await db.select().from(backtestRunsTable).where(eq(backtestRunsTable.id, id));
  if (!row) { res.status(404).json({ error: "not found" }); return; }

  if (!["queued", "validating", "preparing", "running", "generating-report"].includes(row.status)) {
    res.status(409).json({ error: `Cannot cancel a run with status '${row.status}'` });
    return;
  }

  await db.update(backtestRunsTable).set({ status: "cancelled", completedAt: new Date() }).where(eq(backtestRunsTable.id, id));
  res.json({ ok: true });
});

/**
 * Soft-delete a run. NEVER deletes backtest_predictions rows (audit trail).
 * Safety invariant: backtest_predictions are kept even after the run is deleted.
 */
router.delete("/backtests/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [row] = await db.select().from(backtestRunsTable).where(eq(backtestRunsTable.id, id));
  if (!row) { res.status(404).json({ error: "not found" }); return; }

  // Soft-delete only — backtest_predictions are preserved for audit
  await db.update(backtestRunsTable).set({ deletedAt: new Date() }).where(eq(backtestRunsTable.id, id));
  res.json({ ok: true, note: "Run soft-deleted. Prediction rows are preserved for audit." });
});

/** Get individual predictions for a run (paginated, filterable) */
router.get("/backtests/:id/predictions", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const limit = parseIntQ(req.query.limit, 50, 1, 200);
  const offset = parseIntQ(req.query.offset, 0, 0);
  const surface = typeof req.query.surface === "string" ? req.query.surface : undefined;
  const resultType = typeof req.query.resultType === "string" ? req.query.resultType : undefined;
  const correct = typeof req.query.correct === "string" ? req.query.correct : undefined;

  // Use SQL[] so we can push both eq() results and raw sql`` expressions
  const conditions: ReturnType<typeof sql>[] = [eq(backtestPredictionsTable.backtestRunId, id) as ReturnType<typeof sql>];
  if (surface) conditions.push(eq(backtestPredictionsTable.surface, surface) as ReturnType<typeof sql>);
  if (resultType) conditions.push(eq(backtestPredictionsTable.resultType, resultType) as ReturnType<typeof sql>);
  // Push correct/incorrect filter into SQL so limit/offset apply to the already-filtered set
  if (correct === "true") {
    conditions.push(sql`${backtestPredictionsTable.predictedWinnerId} = ${backtestPredictionsTable.actualWinnerId}` as ReturnType<typeof sql>);
  }
  if (correct === "false") {
    conditions.push(sql`(${backtestPredictionsTable.predictedWinnerId} IS DISTINCT FROM ${backtestPredictionsTable.actualWinnerId})` as ReturnType<typeof sql>);
  }

  const rows = await db
    .select()
    .from(backtestPredictionsTable)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(and(...(conditions as any)))
    .orderBy(asc(backtestPredictionsTable.scheduledStartAt))
    .limit(limit)
    .offset(offset);

  res.json(rows);
});

/** Export a backtest as CSV or JSON */
router.get("/backtests/:id/export", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const format = (req.query.format as string) ?? "json";
  if (!["csv", "json"].includes(format)) { res.status(400).json({ error: "format must be csv or json" }); return; }

  const [run] = await db.select().from(backtestRunsTable).where(eq(backtestRunsTable.id, id));
  if (!run) { res.status(404).json({ error: "not found" }); return; }

  const predictions = await db
    .select()
    .from(backtestPredictionsTable)
    .where(eq(backtestPredictionsTable.backtestRunId, id))
    .orderBy(asc(backtestPredictionsTable.scheduledStartAt));

  const meta = {
    backtestId: run.id,
    name: run.name,
    runDate: run.createdAt,
    completedAt: run.completedAt,
    mode: run.mode,
    modelVersion: run.modelVersion,
    datasetVersion: run.datasetVersion,
    dateRange: run.dateRange,
    filters: run.filters,
    rowCounts: run.rowCounts,
    metrics: run.metrics,
  };

  if (format === "json") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="backtest-${id}.json"`);
    res.json({ meta, predictions });
    return;
  }

  // CSV export
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="backtest-${id}.csv"`);

  const headers = [
    "backtestId", "runName", "scheduledStartAt", "player1Name", "player2Name",
    "surface", "matchFormat", "tournamentLevel", "tournamentName",
    "rawProbability", "calibratedProbability", "predictedWinnerName", "actualWinnerName",
    "resultType", "includedInAccuracy", "player1Won",
  ];

  const csvRows = predictions.map((p) => [
    run.id, run.name,
    p.scheduledStartAt?.toISOString() ?? "",
    p.player1Name, p.player2Name,
    p.surface ?? "", p.matchFormat ?? "", p.tournamentLevel ?? "", p.tournamentName ?? "",
    p.rawProbability ?? "", p.calibratedProbability ?? "",
    p.predictedWinnerName ?? "", p.actualWinnerName ?? "",
    p.resultType ?? "", p.includedInAccuracy ? "1" : "0", p.player1Won != null ? (p.player1Won ? "1" : "0") : "",
  ]);

  const csv = [headers, ...csvRows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.send(csv);
});

// ─── Candidate Configs ───────────────────────────────────────────────────────

router.get("/candidate-configs", async (_req, res): Promise<void> => {
  const rows = await db.select().from(candidateConfigsTable).orderBy(desc(candidateConfigsTable.createdAt));
  res.json(rows);
});

router.get("/candidate-configs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const [row] = await db.select().from(candidateConfigsTable).where(eq(candidateConfigsTable.id, id));
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  res.json(row);
});

router.patch("/candidate-configs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const body = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim().slice(0, 200);
  if (typeof body.notes === "string") updates.notes = body.notes.slice(0, 2000);
  if (["pending", "under-review", "approved", "rejected", "archived"].includes(body.status)) updates.status = body.status;

  const [row] = await db.select().from(candidateConfigsTable).where(eq(candidateConfigsTable.id, id));
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  if (row.status === "promoted") { res.status(409).json({ error: "Cannot modify a promoted config" }); return; }

  const [updated] = await db
    .update(candidateConfigsTable)
    .set(updates)
    .where(eq(candidateConfigsTable.id, id))
    .returning();

  res.json(updated);
});

router.delete("/candidate-configs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [row] = await db.select().from(candidateConfigsTable).where(eq(candidateConfigsTable.id, id));
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  if (row.status === "promoted") { res.status(409).json({ error: "Cannot delete a promoted config" }); return; }

  await db.delete(candidateConfigsTable).where(eq(candidateConfigsTable.id, id));
  res.json({ ok: true });
});

/** Promote a candidate config to production (requires all acceptance checks to pass) */
router.post("/candidate-configs/:id/promote", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [config] = await db.select().from(candidateConfigsTable).where(eq(candidateConfigsTable.id, id));
  if (!config) { res.status(404).json({ error: "not found" }); return; }
  if (config.status === "promoted") { res.status(409).json({ error: "Already promoted" }); return; }
  if (!config.acceptanceChecksPassed) {
    res.status(409).json({ error: "Acceptance checks have not all passed. Cannot promote.", checks: config.acceptanceChecks });
    return;
  }

  const body = req.body ?? {};
  const reason = typeof body.reason === "string" ? body.reason : "Manual promotion via Backtesting Portal";

  const [promotion] = await db
    .insert(configPromotionsTable)
    .values({
      candidateConfigId: id,
      oldConfig: {},
      newConfig: config.proposedConfig ?? {},
      reason,
      metrics: config.holdoutMetrics ?? {},
    })
    .returning();

  await db.update(candidateConfigsTable).set({ status: "promoted", updatedAt: new Date() }).where(eq(candidateConfigsTable.id, id));

  res.json({ ok: true, promotion });
});

export default router;
