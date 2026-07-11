/**
 * Shared identifier for the standalone paper-trading job's `job_runs` rows. Kept in its own
 * module (rather than exported from `runPaperTradingJob.ts`) so that importing it from the
 * server's route (`routes/evaluation.ts`, to filter job run history) does NOT pull the job's
 * retry-and-run entrypoint into the server's bundle -- esbuild flattens multiple entry points
 * that share code into one module scope, which would make the job's `isMainModule` guard
 * ambiguous and risk the job auto-running (and exiting the process) inside the long-lived server.
 */
export const PAPER_TRADING_JOB_NAME = "paper-trading-cycle";
