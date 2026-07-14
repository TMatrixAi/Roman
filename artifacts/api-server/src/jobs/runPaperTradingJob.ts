/**
 * Standalone entrypoint for the paper-trading cycle, decoupled from the long-lived API server
 * process (`src/index.ts`). This script runs one cycle to completion and exits -- it holds no
 * timer and does not depend on any server process's uptime.
 *
 * Intended run command for a Replit "Scheduled Deployment" (cron-style, independent of the main
 * app's autoscale/vm deployment): a schedule of every 15 minutes, matching the previous in-process
 * interval, pointed at:
 *
 *   PAPER_TRADING_JOB_STANDALONE=1 node --enable-source-maps dist/jobs/runPaperTradingJob.mjs
 *
 * (built by the same `build.mjs` that produces `dist/index.mjs`; see package.json's
 * `job:paper-trading` script for the equivalent local/dev invocation).
 *
 * Every attempt's outcome is written to `job_runs` (see lib/db/src/schema/evaluation.ts) before
 * the process exits, so a run's result is durable and inspectable via
 * `GET /paper-trading/job-runs` regardless of which process/host executed it -- this is the
 * "alerted, not silently logged" half of the requirement: a gap in successful rows, or a run of
 * failed rows, is the signal an operator (or future alerting integration) can act on.
 *
 * Retries only guard against whole-cycle failures (e.g. a transient DB connection blip). A
 * per-fixture provider hiccup is already handled and recorded inside `runPaperTradingCycle`
 * itself (see its `summary.errors`) and is NOT a reason to retry the whole cycle.
 */
import { db, jobRunsTable } from "@workspace/db";
import { runPaperTradingCycle, type PaperTradingCycleSummary } from "../services/evaluation/paperTrading";
import { gradePendingLedgerPredictions, type LedgerGradingSummary } from "../services/evaluation/ledgerGrading";
import { logger } from "../lib/logger";
import { PAPER_TRADING_JOB_NAME } from "./paperTradingJobName";

export { PAPER_TRADING_JOB_NAME };

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [5_000, 30_000];

interface CombinedCycleSummary extends PaperTradingCycleSummary {
  /** Ledger (user-facing "Custom Match"/"Predict Now") predictions graded this same cycle -- piggybacks on this job's cadence rather than needing its own separate Scheduled Deployment. */
  ledgerGrading: LedgerGradingSummary;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry(): Promise<{ attempts: number; summary: CombinedCycleSummary } | { attempts: number; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const summary = await runPaperTradingCycle();
      const ledgerGrading = await gradePendingLedgerPredictions();
      return { attempts: attempt, summary: { ...summary, ledgerGrading } };
    } catch (err) {
      lastError = err;
      logger.error({ err, attempt, maxAttempts: MAX_ATTEMPTS }, "Paper-trading cycle attempt failed");
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
      }
    }
  }
  return { attempts: MAX_ATTEMPTS, error: lastError };
}

export async function runPaperTradingJob(): Promise<{ ok: boolean }> {
  const startedAt = new Date();
  const outcome = await runWithRetry();
  const finishedAt = new Date();

  if ("summary" in outcome) {
    await db.insert(jobRunsTable).values({
      jobName: PAPER_TRADING_JOB_NAME,
      startedAt,
      finishedAt,
      status: "success",
      attempts: outcome.attempts,
      summary: outcome.summary,
      errorMessage: null,
    });
    logger.info({ ...outcome.summary, attempts: outcome.attempts }, "Paper-trading cycle completed");
    return { ok: true };
  }

  const errorMessage = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
  await db.insert(jobRunsTable).values({
    jobName: PAPER_TRADING_JOB_NAME,
    startedAt,
    finishedAt,
    status: "failed",
    attempts: outcome.attempts,
    summary: null,
    errorMessage,
  });
  logger.error({ err: outcome.error, attempts: outcome.attempts }, "Paper-trading cycle failed after exhausting retries");
  return { ok: false };
}

// Only run when invoked directly via the standalone CLI (e.g. `pnpm run job:paper-trading`), not
// when imported as a module. This can't be detected by comparing `import.meta.url` to
// `process.argv[1]`: `build.mjs` bundles this file's code into TWO separate esbuild entry-point
// bundles (`dist/index.mjs`, which imports `runPaperTradingJob` and calls it in-process, and
// `dist/jobs/runPaperTradingJob.mjs`, the real standalone entry). Once bundled, this code's
// `import.meta.url` resolves to whichever bundle it ended up in -- so when running
// `dist/index.mjs`, the comparison against `process.argv[1]` (also `dist/index.mjs`) false-
// matched, calling `process.exit()` and killing the whole API server ~10s after every startup.
// An explicit env var set only by the standalone CLI scripts (`job:paper-trading` /
// `job:paper-trading:dev`) is immune to that bundling collision.
if (process.env["PAPER_TRADING_JOB_STANDALONE"] === "1") {
  runPaperTradingJob()
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      logger.error({ err }, "Unhandled error running paper-trading job");
      process.exit(1);
    });
}
