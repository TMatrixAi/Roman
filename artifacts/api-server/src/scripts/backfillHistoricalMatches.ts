// CLI entry point for the historical backfill pipeline.
// Usage: pnpm --filter @workspace/api-server run backfill -- --start 2024-01-01 --stop 2024-03-01 [--cutoff 30min]
import { getTennisDataProvider } from "../services/tennisData";
import { runHistoricalBackfill } from "../services/historicalData/backfill";
import type { CutoffOption } from "../services/historicalData/types";
import { pool } from "@workspace/db";

function parseArgs(argv: string[]): { start: string; stop: string; cutoff?: CutoffOption; chunkDays?: number } {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const start = get("--start");
  const stop = get("--stop");
  if (!start || !stop) {
    throw new Error("Usage: --start YYYY-MM-DD --stop YYYY-MM-DD [--cutoff 24h|12h|6h|1h|30min|15min] [--chunkDays N]");
  }
  const cutoff = get("--cutoff") as CutoffOption | undefined;
  const chunkDaysRaw = get("--chunkDays");
  return { start, stop, cutoff, chunkDays: chunkDaysRaw ? parseInt(chunkDaysRaw, 10) : undefined };
}

async function main(): Promise<void> {
  const { start, stop, cutoff, chunkDays } = parseArgs(process.argv.slice(2));
  const provider = getTennisDataProvider();

  const summary = await runHistoricalBackfill(provider, {
    dateStart: start,
    dateStop: stop,
    cutoff,
    chunkDays,
  });

  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
