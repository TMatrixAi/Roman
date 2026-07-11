import app from "./app";
import { logger } from "./lib/logger";

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

  // The live paper-trading loop (lock predictions for newly-eligible upcoming fixtures, mark
  // missed cutoffs, grade completed matches) no longer runs on an in-process timer here -- that
  // only progressed while this exact server process stayed up, so a restart/deploy/crash could
  // silently create gaps. It now runs as a standalone, retrying, durably-logged job
  // (`src/jobs/runPaperTradingJob.ts`, built to dist/jobs/runPaperTradingJob.mjs) invoked on its own
  // schedule -- e.g. a Replit Scheduled Deployment running `pnpm --filter @workspace/api-server
  // run job:paper-trading` every 15 minutes, independent of this server's uptime. See
  // GET /paper-trading/job-runs for the durable run history.
});
