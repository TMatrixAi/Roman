// CLI entry point for the historical backfill pipeline.
// Usage: pnpm --filter @workspace/api-server run backfill -- --start 2024-01-01 --stop 2024-03-01 [--cutoff 30min]
//
// Pass --recompute to rebuild fixtures that are ALREADY stored in this date range instead of
// skipping them as duplicates -- e.g. after a fix to how a stored/derived field (like
// `scheduledStartAt`, Task #73) is computed. Each already-stored fixture is purged (its match row,
// feature snapshots, and any `historical_test` evaluation_predictions pointing at it) and
// reinserted fresh through the exact same import path a brand-new fixture takes. Re-run the
// walk-forward evaluation afterward (`POST /api/evaluation/walk-forward/run`) since fold
// membership and fold metrics are derived from `scheduledStartAt` and will be stale otherwise.
import { getTennisDataProvider } from "../services/tennisData";
import { runHistoricalBackfill } from "../services/historicalData/backfill";
import type { CutoffOption } from "../services/historicalData/types";
import { pool } from "@workspace/db";

function parseArgs(argv: string[]): { start: string; stop: string; cutoff?: CutoffOption; chunkDays?: number; recompute: boolean } {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const start = get("--start");
  const stop = get("--stop");
  if (!start || !stop) {
    throw new Error(
      "Usage: --start YYYY-MM-DD --stop YYYY-MM-DD [--cutoff 24h|12h|6h|1h|30min|15min] [--chunkDays N] [--recompute]",
    );
  }
  const cutoff = get("--cutoff") as CutoffOption | undefined;
  const chunkDaysRaw = get("--chunkDays");
  const recompute = argv.includes("--recompute");
  return { start, stop, cutoff, chunkDays: chunkDaysRaw ? parseInt(chunkDaysRaw, 10) : undefined, recompute };
}

async function main(): Promise<void> {
  const { start, stop, cutoff, chunkDays, recompute } = parseArgs(process.argv.slice(2));
  const provider = getTennisDataProvider();

  const summary = await runHistoricalBackfill(provider, {
    dateStart: start,
    dateStop: stop,
    cutoff,
    chunkDays,
    recompute,
  });

  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
