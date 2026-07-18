/**
 * Direct shadow replay runner — call runShadowPaperTradingReplay for a date range.
 * Usage: pnpm exec tsx scripts/runShadowReplay.ts <startDate> <endDate> <batchLabel>
 */
import { runShadowPaperTradingReplay } from "../src/services/evaluation/shadowReplay";

const [, , startDate, endDate, batchLabel] = process.argv;
if (!startDate || !endDate || !batchLabel) {
  console.error("Usage: tsx scripts/runShadowReplay.ts <startDate> <endDate> <batchLabel>");
  process.exit(1);
}

console.log(`Starting shadow replay: ${startDate} → ${endDate} (batch: ${batchLabel})`);
const t0 = Date.now();

runShadowPaperTradingReplay({ startDate, endDate, batchLabel, overwrite: false })
  .then((summary) => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Done in ${elapsed}s`);
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
