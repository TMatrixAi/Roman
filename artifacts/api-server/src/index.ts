import app from "./app";
import { logger } from "./lib/logger";
import { runPaperTradingCycle } from "./services/evaluation/paperTrading";

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

  // Live paper-trading loop: periodically lock predictions for newly-eligible upcoming
  // fixtures, mark missed cutoffs, and grade completed matches. Runs on a timer inside this
  // long-lived server process rather than a separate scheduled job -- acceptable for Phase 4's
  // scope, but it only progresses while this process is running.
  const PAPER_TRADING_INTERVAL_MS = 15 * 60_000;
  setInterval(() => {
    runPaperTradingCycle().catch((err) => {
      logger.error({ err }, "Paper-trading cycle failed");
    });
  }, PAPER_TRADING_INTERVAL_MS);
});
