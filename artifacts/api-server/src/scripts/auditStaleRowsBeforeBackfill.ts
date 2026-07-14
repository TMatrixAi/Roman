// READ-ONLY pre-backfill audit for the 8 stale-recommendation rows (ids 4, 9, 10, 14, 15, 16, 19,
// 24). Does NOT change any threshold, does NOT write anything. Purpose: for each row, show the
// full stored upsetRisk/disagreement breakdown and state whether EXTREME/HighDisagreement is
// genuinely data-driven or a borderline/threshold-edge case.
//
// Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/auditStaleRowsBeforeBackfill.ts
import { db, predictionsTable, pool } from "@workspace/db";
import { computeWeightedDisagreement, CORE_MODEL_NAMES } from "../services/predictionEngine/disagreement";
import { computeUpsetRisk } from "../services/predictionEngine/upsetRisk";
import type { EngineBreakdown } from "../services/predictionEngine";
import type { ModelVote } from "../services/predictionEngine/ensemble";

const TARGET_IDS = [4, 9, 10, 14, 15, 16, 19, 24];

// Mirrors the exact literal thresholds in disagreement.ts / upsetRisk.ts (NOT re-declared as
// exported constants there, so hardcoded here for reporting purposes only -- never used to
// recompute or change any actual classification).
const HIGH_DISAGREEMENT_STDDEV_THRESHOLD = 11;
const HIGH_DISAGREEMENT_SUPPORT_THRESHOLD = 58;
const MIXED_STDDEV_THRESHOLD = 9;
const MIXED_SUPPORT_THRESHOLD = 65;
const EXTREME_SCORE_THRESHOLD = 55; // HIGH_MAX in upsetRisk.ts
const CORE_FEATURE_MODEL_NAMES = ["Surface Elo", "Serve & Return", "Recent Form", "Fatigue", "Availability", "Head-to-Head"];

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

async function main(): Promise<void> {
  const rows = await db.select().from(predictionsTable);

  for (const row of rows) {
    if (!TARGET_IDS.includes(row.id)) continue;
    const engine = row.engine as EngineBreakdown;
    const margin = Math.abs(row.calibratedProbability - 50);

    console.log(`\n============================================================`);
    console.log(`id ${row.id}: ${row.player1Name} vs ${row.player2Name}`);
    console.log(`============================================================`);
    console.log(`calibratedProbability: ${row.calibratedProbability}  (margin from coin flip: ${fmt(margin)}pts)`);
    console.log(`stored upsetRisk: ${row.upsetRisk}   stored modelAgreement: ${engine.modelAgreement}`);

    // --- Recompute the feature-level (6-module) disagreement reading from the exact models the
    // engine stored -- reconstructs the "governingDisagreement" input the engine originally
    // computed, before any general/specialist or pre-simulator/simulator blend-stage override.
    const featureModels: ModelVote[] = (engine.models ?? []).filter((m) => CORE_FEATURE_MODEL_NAMES.includes(m.modelName));
    const otherModels: ModelVote[] = (engine.models ?? []).filter((m) => !CORE_FEATURE_MODEL_NAMES.includes(m.modelName));
    const recomputedDisagreement = computeWeightedDisagreement(featureModels);

    console.log(`\n-- Feature-module votes (all 6, as stored) --`);
    for (const m of featureModels) {
      const isCore = CORE_MODEL_NAMES.has(m.modelName);
      console.log(
        `  ${m.modelName.padEnd(16)}${isCore ? " [CORE]" : "       "}: player1Probability=${fmt(m.player1Probability)}%  weightUsed=${fmt(m.weightUsed, 3)}  edgeFrom50=${fmt(m.player1Probability - 50)}`,
      );
    }
    if (otherModels.length > 0) {
      console.log(`  (other blend-stage entries present but not part of the core disagreement calc: ${otherModels.map((m) => m.modelName).join(", ")})`);
    }

    console.log(`\n-- Recomputed feature-level disagreement (from the stored votes above) --`);
    console.log(`  weightedStdDev:        ${fmt(recomputedDisagreement.weightedStdDev)}  (HighDisagreement trigger: > ${HIGH_DISAGREEMENT_STDDEV_THRESHOLD}; Mixed trigger: > ${MIXED_STDDEV_THRESHOLD})`);
    console.log(`  leadingSupportPercent: ${fmt(recomputedDisagreement.leadingSupportPercent)}%  (HighDisagreement trigger: < ${HIGH_DISAGREEMENT_SUPPORT_THRESHOLD}%; Mixed trigger: < ${MIXED_SUPPORT_THRESHOLD}%)`);
    console.log(`  coreModelsConflict:    ${recomputedDisagreement.coreModelsConflict}  (>=2 of Surface Elo/Serve&Return/Recent Form each >=15% weight share AND pointing at different players)`);
    console.log(`  -> recomputed modelAgreement: ${recomputedDisagreement.modelAgreement}  (stored: ${engine.modelAgreement})`);

    // Which specific core models actually conflict, and by how much.
    const coreVotes = featureModels.filter((m) => CORE_MODEL_NAMES.has(m.modelName));
    const totalWeight = featureModels.reduce((s, m) => s + m.weightUsed, 0) || 1;
    const directions = coreVotes.map((m) => ({
      name: m.modelName,
      side: m.player1Probability >= 50 ? "player1" : "player2",
      probability: m.player1Probability >= 50 ? m.player1Probability : 100 - m.player1Probability,
      weightShare: m.weightUsed / totalWeight,
    }));
    const uniqueSides = new Set(directions.map((d) => d.side));
    console.log(`\n-- Core models (the only 3 that can drive coreModelsConflict) --`);
    for (const d of directions) {
      console.log(`  ${d.name.padEnd(16)}: favors ${d.side} at ${fmt(d.probability)}%, weight share ${fmt(d.weightShare * 100)}%${d.weightShare < 0.15 ? "  (below 15% meaningful-weight floor -- can't drive conflict)" : ""}`);
    }
    console.log(`  Distinct sides among core models: ${uniqueSides.size === 1 ? "all agree" : `SPLIT (${[...uniqueSides].join(" vs ")})`}`);

    // --- Recompute TODAY's full component-based upsetRisk from the same stored raw inputs, so
    // we can give a definitive present-day verdict even though this row predates the
    // upsetRiskBreakdown field itself. ---
    const minSurfaceSampleSize = Math.min(engine.surfaceElo?.sampleSizePlayer1 ?? 0, engine.surfaceElo?.sampleSizePlayer2 ?? 0);
    const uncertaintyWarningCount = (engine.warnings ?? []).filter((w) => !w.includes("surface Elo is low-confidence") && !w.includes("head-to-head")).length;
    const recomputedUpsetRisk = computeUpsetRisk({
      calibratedProbability: row.calibratedProbability,
      disagreement: recomputedDisagreement,
      rawVsCalibratedConflict: !!engine.modelConflict,
      uncertaintyWarningCount,
      minSurfaceSampleSize,
      tournamentLevel: row.tournamentLevel,
    });
    console.log(`\n-- TODAY's full component-based upsetRisk, recomputed from this row's own stored raw inputs --`);
    console.log(`  inputs: minSurfaceSampleSize=${minSurfaceSampleSize}, uncertaintyWarningCount=${uncertaintyWarningCount}, rawVsCalibratedConflict=${!!engine.modelConflict}, tournamentLevel=${row.tournamentLevel ?? "null"}`);
    console.log(`  score: ${recomputedUpsetRisk.score}  (EXTREME requires score >= ${EXTREME_SCORE_THRESHOLD} PLUS a real guardrail)`);
    console.log(
      `  components: modelConflict=${recomputedUpsetRisk.components.modelConflict}, favoriteWeakness=${recomputedUpsetRisk.components.favoriteWeakness}, uncertainty=${recomputedUpsetRisk.components.uncertainty}, sampleDepth=${recomputedUpsetRisk.components.sampleDepth}, volatility=${recomputedUpsetRisk.components.volatility}`,
    );
    console.log(`  => recomputed upsetRisk tier under TODAY's algorithm: ${recomputedUpsetRisk.upsetRisk}  (stored: ${row.upsetRisk})`);
    console.log(`  note: "${recomputedUpsetRisk.note}"`);

    // --- upsetRisk breakdown as originally stored (component detail), if present ---
    const urb = engine.upsetRiskBreakdown;
    if (!urb) {
      console.log(`\n-- upsetRisk breakdown: NOT STORED on this row at creation (predates the upsetRiskBreakdown field / the 2026-07-13 recalibration). The stored tier "${row.upsetRisk}" came from the OLD two-input formula (margin + modelAgreement only, no guardrail) -- see write-up. --`);
      continue;
    }
    console.log(`\n-- upsetRisk breakdown (stored) --`);
    console.log(`  score: ${urb.score}  (EXTREME requires score >= ${EXTREME_SCORE_THRESHOLD}, PLUS one real guardrail condition)`);
    console.log(
      `  components: modelConflict=${urb.components.modelConflict}, favoriteWeakness=${urb.components.favoriteWeakness}, uncertainty=${urb.components.uncertainty}, sampleDepth=${urb.components.sampleDepth}, volatility=${urb.components.volatility}, matchupHazard=${urb.components.matchupHazard}`,
    );
    console.log(`  topContributors: ${urb.topContributors.join(", ") || "(none)"}`);
    console.log(`  note: "${urb.note}"`);

    // Guardrail check (upsetRisk.ts: EXTREME only stands if one of these independently real
    // conditions holds -- otherwise it's capped to HIGH). Recomputed here purely for reporting.
    const strongCoreConflict = recomputedDisagreement.coreModelsConflict;
    const closeAndUncertain = margin < 3 && urb.components.uncertainty >= 10;
    const severeSampleGap = urb.components.sampleDepth === 10; // sampleDepthScore(0) === 10, i.e. minSurfaceSampleSize === 0
    const highMeasuredUncertainty = urb.components.uncertainty >= 15;
    console.log(`\n-- EXTREME guardrail check (at least one must be true, or it's capped to HIGH) --`);
    console.log(`  strongCoreConflict:      ${strongCoreConflict}`);
    console.log(`  closeAndUncertain (margin<3 & uncertainty>=10): ${closeAndUncertain}  (margin=${fmt(margin)}, uncertainty=${urb.components.uncertainty})`);
    console.log(`  severeSampleGap (sampleDepth component ==10, i.e. minSurfaceSampleSize==0): ${severeSampleGap}`);
    console.log(`  highMeasuredUncertainty (uncertainty>=15): ${highMeasuredUncertainty}`);
    const guardrailPasses = strongCoreConflict || closeAndUncertain || severeSampleGap || highMeasuredUncertainty;
    console.log(`  => guardrail ${guardrailPasses ? "PASSES (EXTREME is real, not a raw-score-only artifact)" : "FAILS -- would be capped to HIGH if this recomputed today"}`);

    // --- Distance-to-threshold summary (how close is this row to flipping category?) ---
    console.log(`\n-- Distance to the nearest threshold that would flip a category --`);
    console.log(`  stddev margin to HighDisagreement cutoff (11): ${fmt(HIGH_DISAGREEMENT_STDDEV_THRESHOLD - recomputedDisagreement.weightedStdDev)} pts of headroom`);
    console.log(`  support margin to HighDisagreement cutoff (58%): ${fmt(recomputedDisagreement.leadingSupportPercent - HIGH_DISAGREEMENT_SUPPORT_THRESHOLD)} pts of headroom`);
    console.log(`  score margin to EXTREME cutoff (55): ${urb.score - EXTREME_SCORE_THRESHOLD} points of headroom`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
