import app from "./app";
import { logger } from "./lib/logger";
import { runPaperTradingJob } from "./jobs/runPaperTradingJob";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Task #121 root cause: this in-process trigger was deliberately removed (see git history)
  // in favor of a standalone, durably-logged job (`src/jobs/runPaperTradingJob.ts`) intended to
  // be invoked by a Replit Scheduled Deployment every 15 minutes, independent of this server's
  // uptime. That Scheduled Deployment was never configured (a prior task to set it up was
  // cancelled -- a person must choose the deployment type), so from the moment this trigger was
  // removed the job simply never ran again: zero new predictions were ever locked or graded.
  // The 111 pre-existing 'missed' rows are artifacts of the handful of manual runs on the day
  // this was removed, not evidence the pipeline has run since.
  //
  // Configuring a Scheduled Deployment is out of scope for this fix (see task notes) -- it
  // requires a person's action. Re-adding the trigger here, inside the already-running API
  // server process, gets real predictions actually locking and grading again without creating
  // any new deployment resource. This does reintroduce the original tradeoff (progress pauses
  // across a server restart/crash), but a paused-while-down job that resumes on restart is a far
  // better outcome than a job that has not run in days and has no path to running again. If a
  // Scheduled Deployment is set up later, this call is safe to remove -- every write below goes
  // through the same idempotent lock (unique fixture index) and pending-only settle guard the
  // standalone job already relies on, so having both trigger paths active briefly (e.g. during a
  // migration) cannot create duplicate or double-graded rows.
  //
  // `runPaperTradingJob` (not the bare cycle) is used so every invocation still gets the same
  // durable `job_runs` row, retry-on-transient-failure behavior, and piggybacked Ledger grading
  // that the standalone script provides -- GET /paper-trading/job-runs stays the one place to
  // check for a stalled pipeline, regardless of which process actually ran it.
  const PAPER_TRADING_INTERVAL_MS = 15 * 60_000;
  let paperTradingCycleInFlight = false;

  function triggerPaperTradingCycle(): void {
    if (paperTradingCycleInFlight) {
      logger.warn("Skipping paper-trading cycle tick: previous cycle is still running");
      return;
    }
    paperTradingCycleInFlight = true;
    runPaperTradingJob()
      .catch((err) => {
        // runPaperTradingJob already records failures to job_runs; this catch only guards
        // against a truly unexpected throw escaping that (e.g. a DB write failure while
        // recording the failure itself) so it can never crash the server process.
        logger.error({ err }, "Paper-trading cycle threw unexpectedly outside its own error handling");
      })
      .finally(() => {
        paperTradingCycleInFlight = false;
      });
  }

  setInterval(triggerPaperTradingCycle, PAPER_TRADING_INTERVAL_MS);
  // Also fire once shortly after startup rather than waiting a full interval, so a server
  // restart doesn't add up to 15 minutes of extra silent gap on top of its own downtime.
  setTimeout(triggerPaperTradingCycle, 10_000);

  // Likewise, the live probability calibration model (the isotonic mapping predictions prefer
  // over the dataQuality-shrink fallback -- see predictionEngine/calibration.ts) only gets
  // refreshed when someone runs a walk-forward evaluation. It now has its own standalone job
  // (`src/jobs/runCalibrationRefitJob.ts`, built to dist/jobs/runCalibrationRefitJob.mjs) intended
  // for a Replit Scheduled Deployment running `pnpm --filter @workspace/api-server run
  // job:calibration-refit` once daily, so the active model can't silently go stale or never exist.
  // See GET /evaluation/calibration-refit/job-runs for the durable run history. That job is out
  // of scope for Task #121 (it does not block paper trading from recording/grading -- it only
  // controls whether calibration is refreshed) and is left as documented follow-up work.
});
