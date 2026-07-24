// Generic stale-recommendation backfill.
//
// Purpose:
// - Recompute recommendation using the CURRENT computeRecommendation logic.
// - Update ONLY rows where stored recommendation differs from recomputed value.
// - Touch ONLY `recommendation` and `engine` (to store provenance metadata).
// - Never modify winner/outcome/probability/data-quality/upset-risk values.
//
// Safety:
// - Dry-run by default.
// - Writes a full JSON backup of affected rows before apply.
// - Skips legacy rows that do not carry a usable `engine.modelAgreement`.
//
// Usage:
//   pnpm --filter @workspace/api-server exec tsx src/scripts/backfillStaleRecommendations.ts
//   pnpm --filter @workspace/api-server exec tsx src/scripts/backfillStaleRecommendations.ts --dry-run
//   pnpm --filter @workspace/api-server exec tsx src/scripts/backfillStaleRecommendations.ts --apply
import { db, predictionsTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeRecommendation } from "../services/predictionEngine/recommendation";
import type { EngineBreakdown } from "../services/predictionEngine";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type PlanRow = {
  id: number;
  before: string;
  after: string;
  graded: boolean;
  tieBreakerApplied: boolean;
  row: any;
};

function hasModelAgreement(engine: unknown): engine is EngineBreakdown & { modelAgreement: string } {
  if (!engine || typeof engine !== "object") return false;
  return typeof (engine as { modelAgreement?: unknown }).modelAgreement === "string";
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;

  const rows = await db.select().from(predictionsTable);
  const plan: PlanRow[] = [];
  let legacySkipped = 0;

  for (const row of rows) {
    const engine = row.engine as unknown;
    if (!hasModelAgreement(engine)) {
      legacySkipped++;
      continue;
    }

    const tieBreakerApplied = (engine as { tieBreakerApplied?: unknown }).tieBreakerApplied === true;
    const recomputed = computeRecommendation(
      row.calibratedProbability,
      row.dataQuality,
      row.dataQualityLabel as never,
      row.upsetRisk as never,
      engine.modelAgreement as never,
      tieBreakerApplied,
    );

    if (recomputed !== row.recommendation) {
      plan.push({
        id: row.id,
        before: row.recommendation,
        after: recomputed,
        graded: row.actualWinnerId !== null || row.resolvedAt !== null,
        tieBreakerApplied,
        row,
      });
    }
  }

  console.log(`Loaded ${rows.length} prediction rows.`);
  console.log(`Skipped legacy rows without engine.modelAgreement: ${legacySkipped}`);
  console.log(`Rows with stale recommendation: ${plan.length}`);

  if (plan.length === 0) {
    console.log("No stale recommendation rows found. Nothing to do.");
    await pool.end();
    return;
  }

  console.log("\nPlan:");
  for (const p of plan.slice(0, 200)) {
    console.log(
      `  #${p.id}: ${p.before} -> ${p.after} (graded=${p.graded}, tieBreakerApplied=${p.tieBreakerApplied})`,
    );
  }
  if (plan.length > 200) {
    console.log(`  ...and ${plan.length - 200} more`);
  }

  const backupDir = path.join(__dirname, "..", "..", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `stale-recommendation-backfill-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(plan.map((p) => p.row), null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  if (dryRun) {
    console.log("\nDRY RUN -- no writes performed. Re-run with --apply to write.");
    await pool.end();
    return;
  }

  console.log("\nApplying updates...");
  const appliedAt = new Date().toISOString();
  for (const p of plan) {
    const currentEngine = p.row.engine as Record<string, unknown>;
    const newEngine: Record<string, unknown> = {
      ...currentEngine,
      recommendationBackfillCorrected: true,
      recommendationBackfillPreviousValue: p.before,
      recommendationBackfillAppliedAt: appliedAt,
      recommendationBackfillWasGradedAtCorrection: p.graded,
      recommendationBackfillReason:
        "Recomputed stored recommendation to match current computeRecommendation logic (including tieBreakerApplied when present). Updated recommendation only; outcome/probabilities/data-quality/upset-risk unchanged.",
    };

    await db.update(predictionsTable).set({ recommendation: p.after, engine: newEngine }).where(eq(predictionsTable.id, p.id));
  }

  console.log(`Done. Updated ${plan.length} row(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
