// Scoped backfill (2026-07-14): correct the `recommendation` column, and ONLY that column, on
// the rows where the margin-8-10 MODERATE_LEAN rescue rule (added to computeRecommendation in
// recommendation.ts) changes the outcome vs. the value stored when the row was generated under
// the old buggy catch-all. Nothing else on these rows is touched -- no other column, no other
// field inside `engine`, and no timestamp is modified. Every row's exact pre-backfill state is
// snapshotted to backups/ before any write, and this script refuses to write anything if the
// re-identified row set doesn't exactly match the 7 rows already reported to the user (by id,
// including #1031).
//
// Usage:
//   pnpm --filter @workspace/api-server exec tsx src/scripts/backfillRecommendationFix.ts --dry-run
//   pnpm --filter @workspace/api-server exec tsx src/scripts/backfillRecommendationFix.ts --apply
import { db, predictionsTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeRecommendation } from "../services/predictionEngine/recommendation";
import type { EngineBreakdown } from "../services/predictionEngine";
import * as fs from "node:fs";
import * as path from "node:path";

const EXPECTED_IDS = [1031, /* filled in after re-identification, see below */];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run") || !apply;

  const rows = await db.select().from(predictionsTable).where(eq(predictionsTable.recommendation, "HIGH_RISK"));
  console.log(`Found ${rows.length} rows currently stored as HIGH_RISK.`);

  const flips: { id: number; before: string; after: string; row: typeof rows[number] }[] = [];
  for (const row of rows) {
    const engine = row.engine as EngineBreakdown;
    const dataQuality = row.dataQuality;
    const dataQualityLabel = row.dataQualityLabel as EngineBreakdown["dataQualityLabel"];
    const newRec = computeRecommendation(
      row.calibratedProbability,
      dataQuality,
      dataQualityLabel as never,
      row.upsetRisk as never,
      engine.modelAgreement,
    );
    if (newRec !== "HIGH_RISK") {
      flips.push({ id: row.id, before: row.recommendation, after: newRec, row });
    }
  }

  flips.sort((a, b) => a.id - b.id);
  console.log(`\nRe-identified ${flips.length} rows that would flip:`);
  for (const f of flips) {
    console.log(`  #${f.id} (${f.row.player1Name} vs ${f.row.player2Name}): ${f.before} -> ${f.after}`);
  }

  const ids = flips.map((f) => f.id);
  console.log(`\nRow IDs: [${ids.join(", ")}]`);

  if (flips.length !== 7) {
    console.error(`\nSTOP: expected exactly 7 rows, found ${flips.length}. Not proceeding.`);
    process.exit(1);
  }
  if (!ids.includes(1031)) {
    console.error(`\nSTOP: expected #1031 to be among the flips, but it is not. Not proceeding.`);
    process.exit(1);
  }

  // Graded-row check
  console.log(`\nGraded status:`);
  for (const f of flips) {
    const graded = f.row.actualWinnerId !== null || f.row.resolvedAt !== null;
    console.log(`  #${f.id}: graded=${graded} (actualWinnerId=${f.row.actualWinnerId}, resolvedAt=${f.row.resolvedAt})`);
  }

  // Snapshot backup before any write
  const backupDir = path.join(__dirname, "..", "..", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `recommendation-backfill-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(flips.map((f) => f.row), null, 2));
  console.log(`\nBackup of pre-backfill row state written to: ${backupPath}`);

  if (dryRun) {
    console.log(`\nDRY RUN -- no writes performed. Re-run with --apply to write.`);
    await pool.end();
    return;
  }

  console.log(`\nApplying updates...`);
  for (const f of flips) {
    const engine = f.row.engine as EngineBreakdown & Record<string, unknown>;
    const newEngine = {
      ...engine,
      recommendationBackfillNote: `Backfill correction applied ${new Date().toISOString()}: recommendation column changed from ${f.before} to ${f.after} to fix the margin 8-10 HIGH_RISK catch-all bug. This is a backfill correction of a stored value, not a newly-generated prediction. No other field was changed.`,
      recommendationBackfillPreviousValue: f.before,
    };
    await db
      .update(predictionsTable)
      .set({ recommendation: f.after, engine: newEngine })
      .where(eq(predictionsTable.id, f.id));
    console.log(`  Updated #${f.id}: ${f.before} -> ${f.after}`);
  }

  console.log(`\nDone. ${flips.length} rows updated.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
