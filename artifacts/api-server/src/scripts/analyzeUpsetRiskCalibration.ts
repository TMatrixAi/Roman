// One-off, expensive batch analysis (per `follow-up-tasks`/spec conventions this is NOT re-run
// casually -- see walkforward-historical-scoring-perf memory note). Reads every graded,
// out-of-sample historical_test/test-segment evaluation_predictions row (each of which stores a
// full live EngineBreakdown snapshot -- see LiveFeatureSnapshot), recomputes a candidate
// component-based upset-risk score for each using ONLY fields that snapshot already contains, and
// reports the ACTUAL observed favorite-loss rate per score bucket. This is the calibration basis
// for the Low/Moderate/High/Extreme tier boundaries hardcoded in `upsetRisk.ts` -- run once,
// results transcribed into code with this script's output as the citation.
//
// Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/analyzeUpsetRiskCalibration.ts
import { db, evaluationPredictionsTable, pool } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { LiveFeatureSnapshot } from "../services/evaluation/types";

// Re-weighted after the first pass below showed modelAgreement/sampleDepth alone barely
// correlate (and, for modelAgreement, correlate in the WRONG direction) with real favorite-loss
// outcomes on this corpus, while raw margin is cleanly monotonic. Component weights are scaled
// down accordingly instead of contributing equally -- see the printed decile table for the
// resulting (much more monotonic) separation used to set final tier boundaries in upsetRisk.ts.
const AGREEMENT_BASE: Record<string, number> = { Strong: 0, Moderate: 2, Mixed: 4, HighDisagreement: 8 };
const CORE_CONFLICT_BONUS = 25;

function favoriteWeaknessScore(margin: number): number {
  if (margin < 3) return 45;
  if (margin < 7) return 30;
  if (margin < 13) return 15;
  return 0;
}

function sampleDepthScore(minSample: number): number {
  if (minSample === 0) return 10;
  if (minSample < 3) return 7;
  if (minSample < 5) return 4;
  return 0;
}

const VOLATILITY_BY_LEVEL: Record<string, number> = { Challenger: 7, WTA250: 7, ATP500: 7, ATP250: 3, ITF: -6 };

async function main(): Promise<void> {
  const rows = await db
    .select()
    .from(evaluationPredictionsTable)
    .where(and(eq(evaluationPredictionsTable.runKind, "historical_test"), eq(evaluationPredictionsTable.segment, "test")));

  const graded = rows.filter(
    (r) => r.status === "graded" && r.includedInAccuracy && r.calibratedProbability !== null && r.actualWinnerId !== null && r.predictedWinnerId !== null && r.featureSnapshot !== null,
  );
  console.log(`Graded, out-of-sample rows with a full engine snapshot: ${graded.length} / ${rows.length} total test-segment rows`);

  type Scored = { score: number; favoriteWon: boolean; tournamentLevel: string | null; margin: number };
  const scored: Scored[] = [];

  for (const row of graded) {
    const snapshot = row.featureSnapshot as unknown as LiveFeatureSnapshot;
    const engine = snapshot?.engine;
    if (!engine) continue;

    const margin = Math.abs(row.calibratedProbability! - 50);
    let modelConflictComponent = engine.modelAgreement && AGREEMENT_BASE[engine.modelAgreement] !== undefined ? AGREEMENT_BASE[engine.modelAgreement] : 0;
    if ((engine as unknown as { coreModelsConflict?: boolean }).coreModelsConflict) modelConflictComponent += CORE_CONFLICT_BONUS;
    const favoriteWeakness = favoriteWeaknessScore(margin);
    const minSample = Math.min(engine.surfaceElo?.sampleSizePlayer1 ?? 0, engine.surfaceElo?.sampleSizePlayer2 ?? 0);
    const sampleDepth = sampleDepthScore(minSample);
    // Uncertainty proxy: non-surface, non-h2h warnings (identity/serve-return/availability/etc.), plus a flat bump for raw-vs-calibrated model conflict.
    const nonSurfaceWarnings = (engine.warnings ?? []).filter((w) => !w.includes("surface Elo is low-confidence") && !w.includes("head-to-head"));
    const uncertainty = Math.min(15, nonSurfaceWarnings.length * 3 + (engine.modelConflict ? 5 : 0));
    const volatility = margin >= 15 ? (VOLATILITY_BY_LEVEL[row.tournamentLevel ?? ""] ?? 0) : 0;

    const score = modelConflictComponent + favoriteWeakness + sampleDepth + uncertainty + Math.max(0, volatility);
    const favoriteWon = row.actualWinnerId === row.predictedWinnerId;
    scored.push({ score, favoriteWon, tournamentLevel: row.tournamentLevel, margin });
  }

  scored.sort((a, b) => a.score - b.score);
  const bucketCount = 10;
  const bucketSize = Math.ceil(scored.length / bucketCount);
  console.log("\nScore decile -> favorite loss rate (this is the calibration basis for tier boundaries):");
  for (let i = 0; i < bucketCount; i++) {
    const bucket = scored.slice(i * bucketSize, (i + 1) * bucketSize);
    if (bucket.length === 0) continue;
    const losses = bucket.filter((b) => !b.favoriteWon).length;
    const scoreRange = `${bucket[0].score.toFixed(0)}-${bucket[bucket.length - 1].score.toFixed(0)}`;
    console.log(`  decile ${i + 1} (score ${scoreRange}, n=${bucket.length}): favorite lost ${((losses / bucket.length) * 100).toFixed(1)}%`);
  }

  // Volatility proxy: among CLEAR favorites (margin >= 15, i.e. not already a close-match case),
  // does the favorite's observed loss rate vary meaningfully by tournamentLevel? This is the
  // closest honest, already-available proxy for ATP/WTA vs Challenger/ITF volatility (Surface
  // and format-specific breakdowns are not reliably populated on historical rows).
  const clearFavorites = scored.filter((s) => s.margin >= 15);
  const byLevel = new Map<string, { n: number; losses: number }>();
  for (const s of clearFavorites) {
    const key = s.tournamentLevel ?? "unknown";
    const entry = byLevel.get(key) ?? { n: 0, losses: 0 };
    entry.n += 1;
    if (!s.favoriteWon) entry.losses += 1;
    byLevel.set(key, entry);
  }
  console.log("\nClear-favorite (margin>=15) loss rate by tournamentLevel (volatility proxy):");
  for (const [level, { n, losses }] of byLevel) {
    console.log(`  ${level}: n=${n}, favorite lost ${n > 0 ? ((losses / n) * 100).toFixed(1) : "n/a"}%`);
  }

  // Component-isolation check: which single component actually correlates with observed outcome?
  const marginBands: [number, number, string][] = [
    [0, 3, "0-3 (50-53%)"],
    [3, 7, "3-7 (53-57%)"],
    [7, 13, "7-13 (57-63%)"],
    [13, Infinity, "13+ (63%+)"],
  ];
  console.log("\nFavorite loss rate by RAW MARGIN band alone:");
  for (const [min, max, label] of marginBands) {
    const inBand = scored.filter((s) => s.margin >= min && s.margin < max);
    const losses = inBand.filter((s) => !s.favoriteWon).length;
    console.log(`  margin ${label}: n=${inBand.length}, favorite lost ${inBand.length > 0 ? ((losses / inBand.length) * 100).toFixed(1) : "n/a"}%`);
  }

  const byAgreement = new Map<string, { n: number; losses: number }>();
  for (const row of graded) {
    const snapshot = row.featureSnapshot as unknown as LiveFeatureSnapshot;
    const agreement = snapshot?.engine?.modelAgreement ?? "unknown";
    const entry = byAgreement.get(agreement) ?? { n: 0, losses: 0 };
    entry.n += 1;
    if (row.actualWinnerId !== row.predictedWinnerId) entry.losses += 1;
    byAgreement.set(agreement, entry);
  }
  console.log("\nFavorite loss rate by modelAgreement alone:");
  for (const [agreement, { n, losses }] of byAgreement) {
    console.log(`  ${agreement}: n=${n}, favorite lost ${n > 0 ? ((losses / n) * 100).toFixed(1) : "n/a"}%`);
  }

  const bySampleDepth = new Map<string, { n: number; losses: number }>();
  for (const row of graded) {
    const snapshot = row.featureSnapshot as unknown as LiveFeatureSnapshot;
    const engine = snapshot?.engine;
    if (!engine) continue;
    const minSample = Math.min(engine.surfaceElo?.sampleSizePlayer1 ?? 0, engine.surfaceElo?.sampleSizePlayer2 ?? 0);
    const key = minSample === 0 ? "0" : minSample < 3 ? "1-2" : minSample < 5 ? "3-4" : "5+";
    const entry = bySampleDepth.get(key) ?? { n: 0, losses: 0 };
    entry.n += 1;
    if (row.actualWinnerId !== row.predictedWinnerId) entry.losses += 1;
    bySampleDepth.set(key, entry);
  }
  console.log("\nFavorite loss rate by min surface sample size alone:");
  for (const [key, { n, losses }] of bySampleDepth) {
    console.log(`  ${key}: n=${n}, favorite lost ${n > 0 ? ((losses / n) * 100).toFixed(1) : "n/a"}%`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
