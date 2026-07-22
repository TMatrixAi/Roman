import { pgTable, serial, text, integer, real, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One row per backtest run. A run scores a slice of historical matches against the
 * current frozen model/calibration (evaluation-only mode) or re-fits calibration on
 * a training window and evaluates on a holdout (training mode). Evaluation runs never
 * alter calibration_models or specialist_models; training runs always write a new
 * candidate_configs row and never overwrite the production config.
 *
 * Safety invariants enforced at the service layer:
 *  - DELETE on backtest_runs never touches evaluation_predictions or backtest_predictions
 *  - evaluation mode never mutates calibration_models / specialist_models
 *  - training mode always inserts a new candidate_configs row (never upserts/overwrites)
 */
export const backtestRunsTable = pgTable(
  "backtest_runs",
  {
    id: serial("id").primaryKey(),

    name: text("name").notNull(),
    notes: text("notes"),

    /**
     * queued → validating → preparing → running → (training?) → generating-report
     *   → completed | completed-with-warnings | failed | cancelled
     */
    status: text("status").notNull().default("queued"),

    /** 'evaluation' = frozen weights, no calibration change. 'optimization' = fit on train window. */
    mode: text("mode").notNull().default("evaluation"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /** ISO date strings { start, end } for the match date window being evaluated */
    dateRange: jsonb("date_range").$type<{ start: string; end: string }>(),

    /** User-selected filters: surface, tour, level, bestOf, includeRetirements, includeWalkovers */
    filters: jsonb("filters").$type<Record<string, unknown>>(),

    /**
     * For optimization mode: { trainStart, trainEnd, validationStart, validationEnd,
     * holdoutStart, holdoutEnd }. Null for evaluation-only runs.
     */
    validationSetup: jsonb("validation_setup").$type<Record<string, string | null>>(),

    modelVersion: text("model_version"),
    configVersion: text("config_version"),
    datasetVersion: text("dataset_version"),

    /** { total, eligible, excluded } row counts from the validation/preview step */
    rowCounts: jsonb("row_counts").$type<{ total: number; eligible: number; excluded: number; exclusionReasons: Record<string, number> }>(),

    /** How many matches have been scored so far (incremented during the run) */
    processedRows: integer("processed_rows").notNull().default(0),

    /** Total rows to process (set when run starts) */
    totalRows: integer("total_rows").notNull().default(0),

    /** Human-readable current stage e.g. "Scoring matches 45 / 120" */
    currentStage: text("current_stage"),

    /**
     * Aggregate metrics JSON computed at run completion.
     * Shape: { n, accuracy, logLoss, brier, eceCalibrated, retirementAdjustedAccuracy,
     *          closeMatchAccuracy, balancedAccuracy, calibrationGap, dateRangeStart,
     *          dateRangeEnd, retiredCount, voidCount, calibrationBuckets[] }
     */
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),

    /** Array of { message, code, matchId? } */
    errors: jsonb("errors").$type<Array<{ message: string; code?: string; matchId?: string }>>(),

    /** FK to candidate_configs row if this was a training run that produced one */
    candidateConfigId: integer("candidate_config_id"),

    /** Whether this run has been soft-deleted (never physically deletes prediction rows) */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("backtest_runs_status_idx").on(table.status),
    index("backtest_runs_mode_idx").on(table.mode),
    index("backtest_runs_created_idx").on(table.createdAt),
    index("backtest_runs_deleted_idx").on(table.deletedAt),
  ],
);

export const insertBacktestRunSchema = createInsertSchema(backtestRunsTable).omit({ id: true, createdAt: true });
export type InsertBacktestRun = z.infer<typeof insertBacktestRunSchema>;
export type BacktestRunRow = typeof backtestRunsTable.$inferSelect;

/**
 * Per-prediction rows for a backtest run. Same conceptual shape as evaluation_predictions
 * but in its own table so backtests don't interfere with the unique indexes on the main
 * evaluation ledger and walk-forward runs can cleanly wipe/rewrite historical_test rows
 * without touching backtest artifacts.
 *
 * Immutability contract: rows are written once by the backtest service and never updated
 * by any other path. Deleting a backtest_run soft-deletes the run row; backtest_predictions
 * for that run are kept for audit purposes (they are cheap to store and hard to reconstruct).
 */
export const backtestPredictionsTable = pgTable(
  "backtest_predictions",
  {
    id: serial("id").primaryKey(),
    backtestRunId: integer("backtest_run_id").notNull(),

    historicalMatchId: text("historical_match_id"),
    player1Id: text("player1_id").notNull(),
    player1Name: text("player1_name").notNull(),
    player2Id: text("player2_id").notNull(),
    player2Name: text("player2_name").notNull(),
    surface: text("surface"),
    matchFormat: text("match_format"),
    tournamentLevel: text("tournament_level"),
    tournamentName: text("tournament_name"),
    scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }).notNull(),

    modelVersion: text("model_version"),

    rawProbability: real("raw_probability"),
    calibratedProbability: real("calibrated_probability"),
    predictedWinnerId: text("predicted_winner_id"),
    predictedWinnerName: text("predicted_winner_name"),

    actualWinnerId: text("actual_winner_id"),
    actualWinnerName: text("actual_winner_name"),
    resultType: text("result_type"), // 'normal' | 'retired' | 'walkover' | 'cancelled'

    /** Whether this row is counted in accuracy (not void, not missed, not excluded by retirement rule) */
    includedInAccuracy: boolean("included_in_accuracy").notNull().default(false),

    /** true when player1 won, null when result not known */
    player1Won: boolean("player1_won"),

    /** Snapshot of feature scores from the prediction engine */
    featureSnapshot: jsonb("feature_snapshot"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("backtest_predictions_run_idx").on(table.backtestRunId),
    index("backtest_predictions_scheduled_idx").on(table.backtestRunId, table.scheduledStartAt),
    index("backtest_predictions_surface_idx").on(table.backtestRunId, table.surface),
  ],
);

export const insertBacktestPredictionSchema = createInsertSchema(backtestPredictionsTable).omit({ id: true, createdAt: true });
export type InsertBacktestPrediction = z.infer<typeof insertBacktestPredictionSchema>;
export type BacktestPredictionRow = typeof backtestPredictionsTable.$inferSelect;

/**
 * Candidate model configurations generated by training-mode backtest runs.
 * These are staged alternatives to the live production config — they are never
 * auto-promoted. A promotion requires explicit user acceptance plus passing
 * acceptance checks (holdout result, minimum sample, no major regression).
 */
export const candidateConfigsTable = pgTable(
  "candidate_configs",
  {
    id: serial("id").primaryKey(),

    strategyId: text("strategy_id"),
    strategyVersion: text("strategy_version"),
    strategyName: text("strategy_name"),
    strategyFamily: text("strategy_family"),
    strategyFingerprint: text("strategy_fingerprint"),
    parentStrategyId: text("parent_strategy_id"),
    parentStrategyVersion: text("parent_strategy_version"),
    creationMethod: text("creation_method"),
    optimizerRunId: text("optimizer_run_id"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    productionStatus: text("production_status"),
    lifecycleStatus: text("lifecycle_status"),
    validationStatus: text("validation_status"),
    walkForwardStatus: text("walk_forward_status"),
    shadowStatus: text("shadow_status"),

    featureSet: jsonb("feature_set").$type<Record<string, unknown>>(),
    weights: jsonb("weights").$type<Record<string, unknown>>(),
    thresholds: jsonb("thresholds").$type<Record<string, unknown>>(),
    calibrationMethod: text("calibration_method"),
    specialistRouting: text("specialist_routing"),
    competitiveBalanceBehavior: jsonb("competitive_balance_behavior").$type<Record<string, unknown>>(),
    evidenceReliabilityBehavior: jsonb("evidence_reliability_behavior").$type<Record<string, unknown>>(),
    abstentionRules: jsonb("abstention_rules").$type<Record<string, unknown>>(),
    recommendationGates: jsonb("recommendation_gates").$type<Record<string, unknown>>(),

    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    promotedBy: text("promoted_by"),
    rollbackStrategyId: text("rollback_strategy_id"),

    name: text("name").notNull(),
    notes: text("notes"),

    /** 'pending' | 'under-review' | 'approved' | 'rejected' | 'promoted' | 'archived' */
    status: text("status").notNull().default("pending"),

    /** FK to the backtest_runs row that generated this config */
    sourceRunId: integer("source_run_id"),

    /** Diff of proposed weights vs production { moduleName: { from, to } } */
    weightDiff: jsonb("weight_diff").$type<Record<string, unknown>>(),

    /** Diff of proposed thresholds vs production */
    thresholdDiff: jsonb("threshold_diff").$type<Record<string, unknown>>(),

    /** Full proposed config snapshot */
    proposedConfig: jsonb("proposed_config").$type<Record<string, unknown>>(),

    /** Metrics from the holdout evaluation { accuracy, logLoss, brier, n, dateRange } */
    holdoutMetrics: jsonb("holdout_metrics").$type<Record<string, unknown>>(),

    /** Metrics from the validation window */
    validationMetrics: jsonb("validation_metrics").$type<Record<string, unknown>>(),

    /** Whether all promotion acceptance checks pass */
    acceptanceChecksPassed: boolean("acceptance_checks_passed"),

    /** Structured list of which checks passed/failed */
    acceptanceChecks: jsonb("acceptance_checks").$type<Array<{ check: string; passed: boolean; detail: string }>>(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("candidate_configs_status_idx").on(table.status),
    index("candidate_configs_source_run_idx").on(table.sourceRunId),
  ],
);

export const insertCandidateConfigSchema = createInsertSchema(candidateConfigsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCandidateConfig = z.infer<typeof insertCandidateConfigSchema>;
export type CandidateConfigRow = typeof candidateConfigsTable.$inferSelect;

/**
 * Immutable audit trail of every time a candidate config was promoted to production.
 * Written at promotion time and never modified (promotions are not reversible programmatically
 * — a rollback requires running a new backtest and promoting the rollback config).
 */
export const configPromotionsTable = pgTable("config_promotions", {
  id: serial("id").primaryKey(),
  candidateConfigId: integer("candidate_config_id").notNull(),
  strategyId: text("strategy_id"),
  strategyVersion: text("strategy_version"),
  strategyFingerprint: text("strategy_fingerprint"),
  oldConfig: jsonb("old_config").$type<Record<string, unknown>>(),
  newConfig: jsonb("new_config").$type<Record<string, unknown>>(),
  reason: text("reason"),
  validationPeriod: text("validation_period"),
  metrics: jsonb("metrics").$type<Record<string, unknown>>(),
  promotedBy: text("promoted_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertConfigPromotionSchema = createInsertSchema(configPromotionsTable).omit({ id: true, approvedAt: true });
export type InsertConfigPromotion = z.infer<typeof insertConfigPromotionSchema>;
export type ConfigPromotionRow = typeof configPromotionsTable.$inferSelect;
