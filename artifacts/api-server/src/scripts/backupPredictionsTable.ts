// Step 3 (2026-07-13 invariant-checking task): backs up the ENTIRE live `predictions` table to a
// timestamped JSON file before any wipe. Never deletes or modifies anything -- read-only dump.
// Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/backupPredictionsTable.ts
import { db, predictionsTable, pool } from "@workspace/db";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const rows = await db.select().from(predictionsTable);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(__dirname, "..", "..", `predictions_backup_${timestamp}.json`);
  writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`Backed up ${rows.length} rows from predictions table to ${outPath}`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    return pool.end().finally(() => process.exit(1));
  });
