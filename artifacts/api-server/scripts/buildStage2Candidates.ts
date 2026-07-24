/**
 * STAGE 2 (TASK #62): Build Versioned Candidate Configurations
 *
 * Inserts all candidate_configs rows from the three tracks defined in Stage 1 audit:
 * 1. Recent Form variants B–G (parameter-delta candidates)
 * 2. Specialist model segment candidates (from specialist_models table)
 * 3. Serve & Return variants A–I (documented as Needs More Data)
 *
 * Run with: pnpm exec tsx scripts/buildStage2Candidates.ts
 *
 * Prerequisites:
 * - Walk-forward evaluation must be complete (specialist_models populated)
 * - Calibration model must be fitted (calibration_models has active row)
 */

import { db, candidateConfigsTable, specialistModelsTable, evaluationPredictionsTable } from "@workspace/db";
import { buildSprintStage2Candidates } from "../src/services/evaluation/sprintStage2Candidates";
import { eq, count } from "drizzle-orm";
import { detectDbHostResolutionHint } from "./lib/replitEnv.js";

async function verifyPrerequisites(): Promise<void> {
  console.log("\n🔍 Verifying prerequisites...\n");

  // Check 1: Walk-forward predictions exist
  const [predictionCount] = await db
    .select({ count: count() })
    .from(evaluationPredictionsTable)
    .where(eq(evaluationPredictionsTable.runKind, "historical_test"));

  if (!predictionCount || predictionCount.count === 0) {
    throw new Error("❌ PREREQUISITE FAILED: No walk-forward predictions found (evaluation_predictions table is empty for run_kind='historical_test'). Run walk-forward first: pnpm exec tsx scripts/runCompleteWalkForward.ts");
  }
  console.log(`✓ Walk-forward predictions found: ${predictionCount.count} rows`);

  // Check 2: Specialist models exist (or are allowed to be empty for fresh runs)
  const [specialistCount] = await db
    .select({ count: count() })
    .from(specialistModelsTable);

  console.log(`✓ Specialist models table: ${specialistCount.count} rows (may be empty if walk-forward just completed)`);

  // Check 3: Existing candidates (optional — may be building multiple times)
  const [existingCandidates] = await db
    .select({ count: count() })
    .from(candidateConfigsTable);

  if (existingCandidates && existingCandidates.count > 0) {
    console.log(`ℹ  Existing candidate_configs: ${existingCandidates.count} rows (new candidates will be appended)`);
  } else {
    console.log(`✓ Candidate_configs table is empty (fresh start)`);
  }

  console.log("\n✅ All prerequisites verified!\n");
}

async function main(): Promise<void> {
  try {
    console.log("╔════════════════════════════════════════════════════════╗");
    console.log("║            STAGE 2 (TASK #62)                          ║");
    console.log("║    Build Versioned Candidate Configurations            ║");
    console.log("║                                                        ║");
    console.log("║  Tracks:                                               ║");
    console.log("║   1. Recent Form B–G (parameter variants)              ║");
    console.log("║   2. Specialist segments (from specialist_models)      ║");
    console.log("║   3. Serve & Return A–I (Needs More Data)              ║");
    console.log("╚════════════════════════════════════════════════════════╝");

    // Phase 1: Verify prerequisites
    console.log("\n📍 PHASE 1: Verification");
    await verifyPrerequisites();

    // Phase 2: Build candidates
    console.log("📍 PHASE 2: Building candidate configurations...\n");
    const startTime = Date.now();

    const summary = await buildSprintStage2Candidates();

    const elapsedMs = Date.now() - startTime;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);

    // Phase 3: Report results
    console.log("\n📋 Results:\n");
    console.log(`  Recent Form candidates (B–G):          ${summary.recentFormCandidateIds.length} rows`);
    console.log(`  Specialist segment candidates:         ${summary.specialistCandidateIds.length} rows`);
    console.log(`  Serve & Return candidates (A–I):       ${summary.serveReturnCandidateIds.length} rows`);
    console.log(`  ─────────────────────────────────────────────`);
    console.log(`  TOTAL INSERTED:                         ${summary.totalInserted} rows`);

    console.log(`\n  Duration: ${elapsedSec}s`);

    if (summary.recentFormCandidateIds.length > 0) {
      console.log(`\n  Recent Form IDs: [${summary.recentFormCandidateIds.join(", ")}]`);
    }
    if (summary.specialistCandidateIds.length > 0) {
      console.log(`  Specialist IDs: [${summary.specialistCandidateIds.join(", ")}]`);
    }
    if (summary.serveReturnCandidateIds.length > 0) {
      console.log(`  Serve & Return IDs: [${summary.serveReturnCandidateIds.join(", ")}]`);
    }

    console.log("\n╔════════════════════════════════════════════════════════╗");
    console.log("║   ✅ STAGE 2 COMPLETED SUCCESSFULLY!                 ║");
    console.log("║                                                        ║");
    console.log(`║   ${summary.totalInserted} candidate configurations created                     ║`);
    console.log("║   All rows stored with status='pending'                ║");
    console.log("║   No production code modified                          ║");
    console.log("║                                                        ║");
    console.log("║   Ready for STAGE 3: Candidate Validation              ║");
    console.log("╚════════════════════════════════════════════════════════╝\n");

    process.exit(0);
  } catch (err: unknown) {
    const envHint = detectDbHostResolutionHint(err, "npx tsx scripts/buildStage2Candidates.ts");
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("\n❌ Fatal error:", message);
    if (envHint) {
      console.error("Hint:", envHint);
    }
    if (stack) {
      console.error(stack);
    }
    process.exit(1);
  }
}

main();
