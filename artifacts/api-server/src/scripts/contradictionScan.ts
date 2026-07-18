/**
 * Task #32 Phase 3: Contradiction scan.
 *
 * Queries all graded predictions and flags structural inconsistencies:
 * - Per-tier accuracy vs overall baseline
 * - Elite tier accuracy
 * - Model-conflict rate by tier
 * - Recommendation tier distribution
 * - High-DQ predictions that were wrong
 *
 * Run: pnpm exec tsx src/scripts/contradictionScan.ts
 */

import { db, predictionsTable } from "@workspace/db";
import { isNotNull, sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TierStats {
  tier: string;
  total: number;
  correct: number;
  accuracy: number;
  avgProbability: number;
  avgDQ: number;
  modelConflictCount: number;
  eliteCount: number;
}

async function main() {
  const rows = await db
    .select()
    .from(predictionsTable)
    .where(isNotNull(predictionsTable.actualWinnerId));

  if (rows.length === 0) {
    console.log("No graded predictions found.");
    process.exit(0);
  }

  const totalGraded = rows.length;
  const totalCorrect = rows.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;
  const baselineAccuracy = totalCorrect / totalGraded;

  // Group by recommendation tier
  const tierMap = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!tierMap.has(row.recommendation)) tierMap.set(row.recommendation, []);
    tierMap.get(row.recommendation)!.push(row);
  }

  const tierStats: TierStats[] = [];
  for (const [tier, tierRows] of tierMap) {
    const correct = tierRows.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;
    const avgProb = tierRows.reduce((s, r) => s + r.calibratedProbability, 0) / tierRows.length;
    const avgDQ = tierRows.reduce((s, r) => s + r.dataQuality, 0) / tierRows.length;
    const modelConflictCount = tierRows.filter((r) => {
      const eng = r.engine as { modelConflict?: boolean } | null;
      return eng?.modelConflict === true;
    }).length;
    const eliteCount = tierRows.filter((r) => {
      const eng = r.engine as { isEliteTier?: boolean } | null;
      return eng?.isEliteTier === true;
    }).length;
    tierStats.push({
      tier,
      total: tierRows.length,
      correct,
      accuracy: correct / tierRows.length,
      avgProbability: avgProb,
      avgDQ,
      modelConflictCount,
      eliteCount,
    });
  }
  tierStats.sort((a, b) => b.total - a.total);

  // Elite tier breakdown
  const eliteRows = rows.filter((r) => {
    const eng = r.engine as { isEliteTier?: boolean } | null;
    return eng?.isEliteTier === true;
  });
  const eliteCorrect = eliteRows.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;
  const eliteAccuracy = eliteRows.length > 0 ? eliteCorrect / eliteRows.length : 0;

  // Model conflict analysis
  const conflictRows = rows.filter((r) => {
    const eng = r.engine as { modelConflict?: boolean } | null;
    return eng?.modelConflict === true;
  });
  const conflictCorrect = conflictRows.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;
  const conflictAccuracy = conflictRows.length > 0 ? conflictCorrect / conflictRows.length : 0;

  // Tie-breaker analysis
  const tieBreakerRows = rows.filter((r) => {
    const eng = r.engine as { tieBreakerApplied?: boolean } | null;
    return eng?.tieBreakerApplied === true;
  });
  const tieBreakerCorrect = tieBreakerRows.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;
  const tieBreakerAccuracy = tieBreakerRows.length > 0 ? tieBreakerCorrect / tieBreakerRows.length : 0;

  // DQ band analysis
  const dqBands: Array<{ label: string; min: number; max: number }> = [
    { label: "0-24 (Poor)", min: 0, max: 24 },
    { label: "25-44 (Marginal)", min: 25, max: 44 },
    { label: "45-54 (Acceptable-low)", min: 45, max: 54 },
    { label: "55-64 (Acceptable-high)", min: 55, max: 64 },
    { label: "65-84 (Good/Strong)", min: 65, max: 84 },
    { label: "85-100 (Excellent)", min: 85, max: 100 },
  ];
  const dqStats = dqBands.map((band) => {
    const bandRows = rows.filter((r) => r.dataQuality >= band.min && r.dataQuality <= band.max);
    const correct = bandRows.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;
    const avgProb = bandRows.length > 0 ? bandRows.reduce((s, r) => s + r.calibratedProbability, 0) / bandRows.length : 0;
    const accuracy = bandRows.length > 0 ? correct / bandRows.length : 0;
    // Expected calibration: if probabilities are well-calibrated, accuracy should roughly equal
    // avgProb (for player1-relative) or predictedWinnerProbability/100.
    const avgWinnerProb = bandRows.length > 0 ? bandRows.reduce((s, r) => s + r.predictedWinnerProbability, 0) / bandRows.length : 0;
    const calibrationGap = accuracy * 100 - avgWinnerProb;
    return { band: band.label, n: bandRows.length, correct, accuracy, avgWinnerProb, calibrationGap };
  });

  // Detect structural contradictions
  const contradictions: string[] = [];

  // 1. STRONG_RECOMMENDATION accuracy vs overall
  const strongRec = tierStats.find((t) => t.tier === "STRONG_RECOMMENDATION");
  if (strongRec && strongRec.accuracy < baselineAccuracy - 0.02) {
    contradictions.push(`STRONG_RECOMMENDATION accuracy (${(strongRec.accuracy * 100).toFixed(1)}%) is BELOW overall baseline (${(baselineAccuracy * 100).toFixed(1)}%) by ${((baselineAccuracy - strongRec.accuracy) * 100).toFixed(1)}pt — tier selection may be anti-predictive`);
  }

  // 2. DQ 85-100 overconfidence (known issue from baseline snapshot)
  const excellentDQ = dqStats.find((d) => d.band === "85-100 (Excellent)");
  if (excellentDQ && excellentDQ.n >= 10 && Math.abs(excellentDQ.calibrationGap) > 5) {
    contradictions.push(`DQ 85-100 band: calibration gap = ${excellentDQ.calibrationGap.toFixed(1)}pt (accuracy ${(excellentDQ.accuracy * 100).toFixed(1)}% vs stated ${excellentDQ.avgWinnerProb.toFixed(1)}%) on n=${excellentDQ.n} — overconfidence or underconfidence confirmed`);
  }

  // 3. Elite tier vs overall
  if (eliteRows.length >= 5 && eliteAccuracy < baselineAccuracy) {
    contradictions.push(`ELITE tier accuracy (${(eliteAccuracy * 100).toFixed(1)}%) is BELOW overall baseline (${(baselineAccuracy * 100).toFixed(1)}%) on n=${eliteRows.length} — elite gates may not be selecting the right subset`);
  }

  // 4. Model conflict predictions
  if (conflictRows.length >= 5 && conflictAccuracy < 0.45) {
    contradictions.push(`MODEL CONFLICT predictions have very low accuracy (${(conflictAccuracy * 100).toFixed(1)}%) on n=${conflictRows.length} — calibration override is consistently wrong`);
  }

  // 5. DO_NOT_RECOMMEND accuracy should be lowest
  const doNotRec = tierStats.find((t) => t.tier === "DO_NOT_RECOMMEND");
  const moderateLean = tierStats.find((t) => t.tier === "MODERATE_LEAN");
  if (doNotRec && moderateLean && doNotRec.accuracy > moderateLean.accuracy + 0.05) {
    contradictions.push(`DO_NOT_RECOMMEND accuracy (${(doNotRec.accuracy * 100).toFixed(1)}%) exceeds MODERATE_LEAN (${(moderateLean.accuracy * 100).toFixed(1)}%) — gate conditions may be mis-calibrated`);
  }

  // Predictions with decisionTrace (Task #32 additions)
  const withTrace = rows.filter((r) => r.decisionTrace !== null);

  // Build the report
  const lines: string[] = [
    "# Engine Contradiction Scan — Task #32",
    `**Generated:** ${new Date().toISOString()}`,
    `**Graded predictions:** ${totalGraded}`,
    `**Overall accuracy:** ${(baselineAccuracy * 100).toFixed(1)}% (${totalCorrect}/${totalGraded})`,
    `**With decisionTrace:** ${withTrace.length}`,
    "",
    "---",
    "",
    "## Per-Tier Accuracy",
    "",
    "| Tier | n | Accuracy | Avg Prob | Avg DQ | Model Conflicts | Elite |",
    "|---|---|---|---|---|---|---|",
    ...tierStats.map((t) => {
      const marker = t.accuracy < baselineAccuracy - 0.03 ? " ⚠️" : "";
      return `| ${t.tier}${marker} | ${t.total} | ${(t.accuracy * 100).toFixed(1)}% | ${t.avgProbability.toFixed(1)}% | ${t.avgDQ.toFixed(0)} | ${t.modelConflictCount} | ${t.eliteCount} |`;
    }),
    `| **OVERALL** | **${totalGraded}** | **${(baselineAccuracy * 100).toFixed(1)}%** | — | — | ${conflictRows.length} | ${eliteRows.length} |`,
    "",
    "## Elite Tier",
    "",
    `- n = ${eliteRows.length}`,
    `- Accuracy: ${(eliteAccuracy * 100).toFixed(1)}% (${eliteCorrect}/${eliteRows.length})`,
    `- vs. baseline: ${(eliteAccuracy * 100 - baselineAccuracy * 100).toFixed(1)}pt`,
    "",
    "## Model Conflict",
    "",
    `- n = ${conflictRows.length} (${((conflictRows.length / totalGraded) * 100).toFixed(1)}% of graded)`,
    `- Accuracy: ${(conflictAccuracy * 100).toFixed(1)}%`,
    `- vs. baseline: ${(conflictAccuracy * 100 - baselineAccuracy * 100).toFixed(1)}pt`,
    "",
    "## Tie-Breaker Applied",
    "",
    `- n = ${tieBreakerRows.length} (${((tieBreakerRows.length / totalGraded) * 100).toFixed(1)}% of graded)`,
    `- Accuracy: ${tieBreakerRows.length > 0 ? (tieBreakerAccuracy * 100).toFixed(1) : "n/a"}%`,
    tieBreakerRows.length > 0 ? `- vs. baseline: ${(tieBreakerAccuracy * 100 - baselineAccuracy * 100).toFixed(1)}pt` : "",
    "",
    "## Data Quality Band Calibration",
    "",
    "| DQ Band | n | Accuracy | Avg Winner Prob | Calibration Gap |",
    "|---|---|---|---|---|",
    ...dqStats.map((d) => {
      const gapStr = d.n === 0 ? "n/a" : `${d.calibrationGap > 0 ? "+" : ""}${d.calibrationGap.toFixed(1)}pt`;
      const marker = d.n > 10 && Math.abs(d.calibrationGap) > 5 ? " ⚠️" : "";
      return `| ${d.band}${marker} | ${d.n} | ${d.n > 0 ? (d.accuracy * 100).toFixed(1) + "%" : "—"} | ${d.n > 0 ? d.avgWinnerProb.toFixed(1) + "%" : "—"} | ${gapStr} |`;
    }),
    "",
    "## Structural Contradictions Found",
    "",
    contradictions.length === 0
      ? "✅ No structural contradictions detected in the graded corpus."
      : contradictions.map((c) => `- ⚠️ ${c}`).join("\n"),
    "",
    "---",
    "",
    `*Report written by \`contradictionScan.ts\` (Task #32). Baseline = overall accuracy on graded predictions. Calibration gap = (accuracy% − avg predicted winner probability). Negative gap = model overconfident; positive = underconfident.*`,
  ];

  const report = lines.join("\n");
  const outPath = path.join(__dirname, "../../docs/audit-task32-contradiction-scan.md");
  fs.writeFileSync(outPath, report, "utf-8");
  console.log(report);
  console.log(`\nReport written to ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
