/**
 * Shared identifier for the standalone calibration-refit job's `job_runs` rows. Kept in its own
 * module (rather than exported from `runCalibrationRefitJob.ts`) for the same reason as
 * `paperTradingJobName.ts`: importing it from a route (to filter job run history) must not pull
 * the job's `isMainModule`-guarded entrypoint into the server's bundle.
 */
export const CALIBRATION_REFIT_JOB_NAME = "calibration-refit";
