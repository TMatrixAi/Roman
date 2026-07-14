/**
 * Standalone entrypoint for advancing the canonical `historical_matches` record, decoupled from
 * the long-lived API server process (`src/index.ts`) -- same pattern as `runPaperTradingJob.ts`
 * and `runCalibrationRefitJob.ts`.
 *
 * Before this job existed, `historical_matches` was only ever extended by someone manually
 * re-running `pnpm --filter @workspace/api-server run backfill -- --start ... --stop ...` with
 * freshly-chosen dates (Task #144) -- so it silently stopped advancing over a year ago the moment
 * nobody remembered to do that. This job removes the "someone must remember" step: it always
 * picks up the day after whatever `historical_matches` currently covers and extends forward
 * through yesterday (see `runIncrementalHistoricalBackfill`), so running it on a schedule keeps
 * the record current with zero manual date bookkeeping.
 *
 * Intended run command for a Replit Scheduled Deployment: once daily (matching
 * `runCalibrationRefitJob`'s cadence -- new completed matches accumulate at most a few times a
 * day, so there's no benefit to running more often), pointed at:
 *
 *   HISTORICAL_BACKFILL_JOB_STANDALONE=1 node --enable-source-maps dist/jobs/runHistoricalBackfillJob.mjs
 *
 * (built by the same `build.mjs` that produces `dist/index.mjs`; see package.json's
 * `job:historical-backfill` script for the equivalent local/dev invocation). Until that Scheduled
 * Deployment is configured (a person's action -- see the paper-trading job's history for why an
 * in-process timer alone isn't durable across restarts), `src/index.ts` also fires this job on an
 * in-process interval so the record keeps advancing today rather than waiting on that setup step.
 *
 * Every attempt's outcome is written to `job_runs` before the process exits, so a run's result is
 * durable and inspectable via `GET /evaluation/historical-backfill/job-runs` regardless of which
 * process/host executed it -- a gap in recent successful rows is the signal an operator (or
 * future alerting integration) can act on. `GET /evaluation/historical-backfill/freshness` gives
 * the complementary "how far does the data reach right now" view.
 *
 * A "nothing new to fetch yet" outcome (`skipped: true`) is not an error -- it's recorded as a
 * successful run so it's visible without being treated as a failure worth retrying.
 */
import { db, jobRunsTable } from "@workspace/db";
import { getTennisDataProvider } from "../services/tennisData";
import { runIncrementalHistoricalBackfill, type IncrementalBackfillResult } from "../services/historicalData/backfill";
import { logger } from "../lib/logger";
import { HISTORICAL_BACKFILL_JOB_NAME } from "./historicalBackfillJobName";

export { HISTORICAL_BACKFILL_JOB_NAME };

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [5_000, 30_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry(): Promise<{ attempts: number; result: IncrementalBackfillResult } | { attempts: number; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const provider = getTennisDataProvider();
      const result = await runIncrementalHistoricalBackfill(provider);
      return { attempts: attempt, result };
    } catch (err) {
      lastError = err;
      logger.error({ err, attempt, maxAttempts: MAX_ATTEMPTS }, "Historical-backfill cycle attempt failed");
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
      }
    }
  }
  return { attempts: MAX_ATTEMPTS, error: lastError };
}

export async function runHistoricalBackfillJob(): Promise<{ ok: boolean }> {
  const startedAt = new Date();
  const outcome = await runWithRetry();
  const finishedAt = new Date();

  if ("result" in outcome) {
    await db.insert(jobRunsTable).values({
      jobName: HISTORICAL_BACKFILL_JOB_NAME,
      startedAt,
      finishedAt,
      status: "success",
      attempts: outcome.attempts,
      summary: outcome.result,
      errorMessage: null,
    });
    logger.info({ ...outcome.result, attempts: outcome.attempts }, "Historical-backfill cycle completed");
    return { ok: true };
  }

  const errorMessage = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
  await db.insert(jobRunsTable).values({
    jobName: HISTORICAL_BACKFILL_JOB_NAME,
    startedAt,
    finishedAt,
    status: "failed",
    attempts: outcome.attempts,
    summary: null,
    errorMessage,
  });
  logger.error({ err: outcome.error, attempts: outcome.attempts }, "Historical-backfill cycle failed after exhausting retries");
  return { ok: false };
}

// Only run when invoked directly via the standalone CLI, guarded by an explicit env var rather
// than an `import.meta.url`/`process.argv[1]` comparison -- see `runPaperTradingJob.ts` for the
// incident (API server crashing ~10s after every startup) that comparison caused once this file's
// code ended up bundled into both `dist/index.mjs` and its own standalone entry point.
if (process.env["HISTORICAL_BACKFILL_JOB_STANDALONE"] === "1") {
  runHistoricalBackfillJob()
    .then(({ ok }) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      logger.error({ err }, "Unhandled error running historical-backfill job");
      process.exit(1);
    });
}
