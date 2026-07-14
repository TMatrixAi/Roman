/**
 * Shared identifier for the standalone historical-backfill job's `job_runs` rows. Kept in its own
 * module (rather than exported from `runHistoricalBackfillJob.ts`) for the same reason as
 * `paperTradingJobName.ts`: importing it from the server's route (`routes/evaluation.ts`, to
 * filter job run history) must not pull the job's retry-and-run entrypoint into the server's
 * bundle, or its standalone-invocation env-var guard becomes ambiguous across esbuild's separate
 * entry-point bundles.
 */
export const HISTORICAL_BACKFILL_JOB_NAME = "historical-backfill-cycle";
