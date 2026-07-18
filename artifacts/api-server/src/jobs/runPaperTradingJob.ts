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
 *
 * ### Grading pipeline (this cycle)
 *
 * 1. `runPaperTradingCycle()` — locks fresh predictions for fixtures whose cutoff has arrived,
 *    marks missed windows, and grades pending paper-trade evaluation predictions using per-player
 *    `getPlayerMatches()` calls (composite provider — RapidAPI Tennis primary / API-Tennis fallback).
 *
 * 2. Tennis results batch — collects every unique player ID from pending ledger predictions,
 *    fetches their match histories in one deduplicated batch (one call per player rather than
 *    one per prediction), then grades pending user-facing ledger predictions from that batch.
 *    A failed fetch for any one player leaves that player's predictions pending; it does not
 *    block grading for all other players.
 *
 * ### Downstream refresh
 *
 * All downstream statistics (Prediction History accuracy totals, paper-trading P&L, Shadow
 * Replay win-rate) are computed on-demand directly from `predictionsTable` and
 * `evaluationPredictionsTable` by their respective API routes and dashboard queries.  No
 * explicit cache-flush or re-aggregation step is required after grading; the next read
 * will automatically reflect newly-graded rows.
 */
import { db, jobRunsTable } from "@workspace/db";
import { runPaperTradingCycle, type PaperTradingCycleSummary } from "../services/evaluation/paperTrading";
import {
  gradePendingLedgerPredictionsFromBatch,
  type LedgerGradingSummary,
} from "../services/evaluation/ledgerGrading";
import {
  collectPendingPlayerIds,
  fetchMatchResultsBatch,
  type MatchResultsBatch,
} from "../services/evaluation/tennisResultsFetcher";
import { getTennisDataProvider } from "../services/tennisData";
import { logger } from "../lib/logger";
import { PAPER_TRADING_JOB_NAME } from "./paperTradingJobName";

export { PAPER_TRADING_JOB_NAME };

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [5_000, 30_000];

interface CombinedCycleSummary extends PaperTradingCycleSummary {
  /** Ledger (user-facing "Custom Match"/"Predict Now") predictions graded this same cycle. */
  ledgerGrading: LedgerGradingSummary;
  /**
   * Stats from the shared tennis results batch used for ledger grading.
   * Surfaces fetch failures so operators can spot persistent provider issues without
   * trawling server logs.
   */
  batchFetch: {
    uniquePlayersRequested: number;
    succeeded: number;
    failed: number;
    errors: string[];
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry(): Promise<
  { attempts: number; summary: CombinedCycleSummary } | { attempts: number; error: unknown }
> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Step 1: Lock new paper-trade predictions and grade pending ones.
      // This uses per-player getPlayerMatches() calls internally (N+1, but cached
      // via the MatchStat TtlCache at 15-min TTL, so repeated calls within a window
      // are free). Safe to run while the API server is live.
      const cycleResult = await runPaperTradingCycle();

      // Step 2: Build a deduplicated tennis results batch for all pending ledger
      // predictions. Collect player IDs AFTER the cycle so any fixtures that were
      // just locked (and may have player overlap) are already committed.
      const provider = getTennisDataProvider();
      const playerIds = await collectPendingPlayerIds();

      let batch: MatchResultsBatch;
      if (playerIds.length === 0) {
        batch = { matchesByPlayerId: new Map(), fetchErrors: [] };
      } else {
        batch = await fetchMatchResultsBatch(provider, playerIds);
      }

      // Step 3: Grade pending ledger predictions from the batch. Predictions whose
      // player fetch failed stay pending — they'll be retried next cycle.
      const ledgerGrading = await gradePendingLedgerPredictionsFromBatch(batch);

      // Log any unresolved predictions so operators can monitor the pending backlog.
      if (ledgerGrading.unresolvedIds.length > 0) {
        logger.info(
          { count: ledgerGrading.unresolvedIds.length, sample: ledgerGrading.unresolvedIds.slice(0, 5) },
          "Ledger grading: predictions still awaiting a real match result (normal pending state, not errors)",
        );
      }
      if (batch.fetchErrors.length > 0) {
        logger.warn(
          { count: batch.fetchErrors.length, errors: batch.fetchErrors },
          "Tennis results batch: some players could not be fetched — their predictions stay pending",
        );
      }

      const batchFetch = {
        uniquePlayersRequested: playerIds.length,
        succeeded: playerIds.length - batch.fetchErrors.length,
        failed: batch.fetchErrors.length,
        errors: batch.fetchErrors,
      };

      return {
        attempts: attempt,
        summary: { ...cycleResult, ledgerGrading, batchFetch },
      };
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
    logger.info(
      {
        ...outcome.summary,
        attempts: outcome.attempts,
        ledgerGraded: outcome.summary.ledgerGrading.graded,
        ledgerErrors: outcome.summary.ledgerGrading.errors.length,
        batchFetch: outcome.summary.batchFetch,
      },
      "Paper-trading + ledger-grading cycle completed",
    );
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
