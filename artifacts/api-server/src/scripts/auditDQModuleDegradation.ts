// Diagnostic for Task #111 (root cause of the Task #75 DQ-calibration reversal above ~DQ55).
// Reproduces the same real graded/accuracy-eligible corpus and DQ bucketing used in
// docs/audit-task75-dq-threshold-revalidation.md, but breaks each bucket down by PER-MODULE
// reliability and by real-world context (tournament level, surface sample depth) to isolate
// whether the reversal traces to blend weighting, a specific module's own reliability formula, or
// an interaction/selection effect.
//
// Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/auditDQModuleDegradation.ts
import { db, evaluationPredictionsTable, pool, type EvaluationPredictionRow } from "@workspace/db";
import { and, inArray } from "drizzle-orm";
import { MODULE_IMPORTANCE, EXCLUDED_FROM_DATA_QUALITY } from "../services/predictionEngine/dataQuality";
import type { LiveFeatureSnapshot } from "../services/evaluation/types";
import type { EngineBreakdown } from "../services/predictionEngine";

type ModuleKey = keyof typeof MODULE_IMPORTANCE;
const MODULE_KEYS = Object.keys(MODULE_IMPORTANCE) as ModuleKey[];

function extractEngine(row: EvaluationPredictionRow): EngineBreakdown | null {
  const snapshot = row.featureSnapshot as unknown as Partial<LiveFeatureSnapshot> | null;
  const engine = snapshot?.engine as EngineBreakdown | undefined;
  if (!engine) return null;
  return engine;
}

function moduleReliability(engine: EngineBreakdown, key: ModuleKey): number | null {
  const mod = (engine as unknown as Record<string, { reliability?: number } | undefined>)[key];
  return typeof mod?.reliability === "number" ? mod.reliability : null;
}

async function fetchRows(): Promise<EvaluationPredictionRow[]> {
  const allRows = await db
    .select()
    .from(evaluationPredictionsTable)
    .where(and(inArray(evaluationPredictionsTable.runKind, ["historical_test", "paper_trade", "live"]), inArray(evaluationPredictionsTable.status, ["graded"])));
  // Same scoping as the Task #75 audit: genuinely out-of-sample rows only.
  return allRows.filter((r) => (r.runKind === "historical_test" ? r.segment === "test" : true) && r.includedInAccuracy === true);
}

function favoriteWinRateAndConfidence(rows: EvaluationPredictionRow[]) {
  const withOutcome = rows.filter((r) => r.calibratedProbability !== null && r.actualWinnerId !== null);
  if (withOutcome.length === 0) return { n: 0, favoriteWinRate: null, avgConfidence: null, gap: null, logLoss: null };
  let favoriteWins = 0;
  let confidenceSum = 0;
  let logLossSum = 0;
  for (const r of withOutcome) {
    const p1Prob = r.calibratedProbability! / 100;
    const favoredPlayer1 = p1Prob >= 0.5;
    const favoriteWon = favoredPlayer1 ? r.actualWinnerId === r.player1Id : r.actualWinnerId === r.player2Id;
    if (favoriteWon) favoriteWins++;
    const confidence = Math.max(p1Prob, 1 - p1Prob);
    confidenceSum += confidence;
    const outcome = r.actualWinnerId === r.player1Id ? 1 : 0;
    const clamped = Math.min(0.999, Math.max(0.001, p1Prob));
    logLossSum += -(outcome * Math.log(clamped) + (1 - outcome) * Math.log(1 - clamped));
  }
  return {
    n: withOutcome.length,
    favoriteWinRate: (favoriteWins / withOutcome.length) * 100,
    avgConfidence: (confidenceSum / withOutcome.length) * 100,
    gap: (favoriteWins / withOutcome.length) * 100 - (confidenceSum / withOutcome.length) * 100,
    logLoss: logLossSum / withOutcome.length,
  };
}

async function main(): Promise<void> {
  const rows = await fetchRows();
  console.log(`Total genuinely out-of-sample graded/accuracy-eligible rows: ${rows.length}`);

  type Entry = { row: EvaluationPredictionRow; engine: EngineBreakdown; dataQuality: number };
  const entries: Entry[] = [];
  for (const row of rows) {
    const engine = extractEngine(row);
    const snapshot = row.featureSnapshot as unknown as Partial<LiveFeatureSnapshot>;
    if (!engine || typeof snapshot.dataQuality !== "number") continue;
    entries.push({ row, engine, dataQuality: snapshot.dataQuality });
  }
  console.log(`Rows with usable engine breakdown + dataQuality: ${entries.length}`);

  const buckets: [number, number, string][] = [
    [0, 20, "0-20"],
    [20, 25, "20-25"],
    [25, 45, "25-45"],
    [45, 55, "45-55"],
    [55, 65, "55-65"],
    [65, 85, "65-85"],
    [85, 101, "85-100"],
  ];

  console.log("\n=== Finding 0: reproduce Task #75's bucketed calibration table on the CURRENT corpus ===");
  for (const [min, max, label] of buckets) {
    const inBucket = entries.filter((e) => e.dataQuality >= min && e.dataQuality < max);
    const stats = favoriteWinRateAndConfidence(inBucket.map((e) => e.row));
    console.log(
      `  DQ ${label}: n=${stats.n}, favoriteWinRate=${stats.favoriteWinRate?.toFixed(1)}%, avgConfidence=${stats.avgConfidence?.toFixed(1)}%, gap=${stats.gap?.toFixed(1)}, logLoss=${stats.logLoss?.toFixed(3)}`,
    );
  }

  console.log("\n=== Finding 1: average per-module reliability by DQ bucket ===");
  console.log(`  (module importance weights: ${MODULE_KEYS.map((k) => `${k}=${MODULE_IMPORTANCE[k]}`).join(", ")}; excluded from DQ blend: ${[...EXCLUDED_FROM_DATA_QUALITY].join(", ")})`);
  for (const [min, max, label] of buckets) {
    const inBucket = entries.filter((e) => e.dataQuality >= min && e.dataQuality < max);
    if (inBucket.length === 0) continue;
    const avgByModule = MODULE_KEYS.map((key) => {
      const values = inBucket.map((e) => moduleReliability(e.engine, key)).filter((v): v is number => v !== null);
      const avg = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
      const atCap = values.filter((v) => v >= 95).length;
      return { key, avg, n: values.length, pctAtCap: values.length > 0 ? (atCap / values.length) * 100 : null };
    });
    console.log(
      `  DQ ${label} (n=${inBucket.length}): ` +
        avgByModule.map((m) => `${m.key}=${m.avg?.toFixed(1) ?? "n/a"}(${m.pctAtCap?.toFixed(0) ?? "?"}%>=95)`).join(", "),
    );
  }

  console.log("\n=== Finding 2: within-model correlation between reliability and THAT MODEL'S OWN directional correctness, split at DQ 55 ===");
  console.log("  (only surfaceElo/serveReturn/recentForm/headToHead actually vote in the ensemble -- availability/fatigue/matchLoadRecovery are excluded from the vote, see EXCLUDED_FROM_ENSEMBLE)");
  const VOTING_MODEL_NAMES: Record<string, string> = { "Surface Elo": "surfaceElo", "Serve & Return": "serveReturn", "Recent Form": "recentForm", "Head-to-Head": "headToHead" };
  for (const [lowDQ, highDQ, label] of [
    [0, 55, "DQ<55"],
    [55, 101, "DQ>=55"],
  ] as [number, number, string][]) {
    const inRange = entries.filter((e) => e.dataQuality >= lowDQ && e.dataQuality < highDQ);
    for (const [modelName, key] of Object.entries(VOTING_MODEL_NAMES)) {
      const withReliabilityAndOutcome = inRange
        .map((e) => {
          const vote = e.engine.models?.find((m) => m.modelName === modelName);
          if (!vote || e.row.actualWinnerId === null) return null;
          const favoredPlayer1 = vote.player1Probability >= 50;
          const wasCorrect = favoredPlayer1 ? e.row.actualWinnerId === e.row.player1Id : e.row.actualWinnerId === e.row.player2Id;
          return { reliability: vote.reliability, wasCorrect };
        })
        .filter((v): v is { reliability: number; wasCorrect: boolean } => v !== null);
      if (withReliabilityAndOutcome.length < 20) continue;
      const lowRel = withReliabilityAndOutcome.filter((v) => v.reliability < 50);
      const highRel = withReliabilityAndOutcome.filter((v) => v.reliability >= 50);
      const acc = (arr: typeof withReliabilityAndOutcome) => (arr.length > 0 ? ((arr.filter((v) => v.wasCorrect).length / arr.length) * 100).toFixed(1) : "n/a");
      console.log(`  ${key} @ ${label}: n=${withReliabilityAndOutcome.length}, lowRel(<50) accuracy=${acc(lowRel)}% (n=${lowRel.length}), highRel(>=50) accuracy=${acc(highRel)}% (n=${highRel.length})`);
    }
  }

  console.log("\n=== Finding 3: tournament level mix by DQ bucket (are high-DQ matches disproportionately top-tier/rivalry matchups?) ===");
  for (const [min, max, label] of buckets) {
    const inBucket = entries.filter((e) => e.dataQuality >= min && e.dataQuality < max);
    if (inBucket.length === 0) continue;
    const levelCounts = new Map<string, number>();
    for (const e of inBucket) {
      const lvl = e.row.tournamentLevel ?? "unknown";
      levelCounts.set(lvl, (levelCounts.get(lvl) ?? 0) + 1);
    }
    const sorted = [...levelCounts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`  DQ ${label} (n=${inBucket.length}): ` + sorted.map(([lvl, n]) => `${lvl}=${((n / inBucket.length) * 100).toFixed(0)}%`).join(", "));
  }

  console.log("\n=== Finding 4: surface-sample depth (real per-match data richness) by DQ bucket ===");
  for (const [min, max, label] of buckets) {
    const inBucket = entries.filter((e) => e.dataQuality >= min && e.dataQuality < max);
    if (inBucket.length === 0) continue;
    const depths = inBucket
      .map((e) => (e.engine as unknown as { surfaceSampleDepth?: { minSample?: number; label?: string } }).surfaceSampleDepth)
      .filter((d): d is { minSample?: number; label?: string } => !!d);
    const labelCounts = new Map<string, number>();
    for (const d of depths) labelCounts.set(d.label ?? "unknown", (labelCounts.get(d.label ?? "unknown") ?? 0) + 1);
    const avgMinSample = depths.length > 0 ? depths.reduce((s, d) => s + (d.minSample ?? 0), 0) / depths.length : null;
    console.log(
      `  DQ ${label} (n=${inBucket.length}): avgMinSample=${avgMinSample?.toFixed(1)}, ` +
        [...labelCounts.entries()].map(([lbl, n]) => `${lbl}=${((n / depths.length) * 100).toFixed(0)}%`).join(", "),
    );
  }

  console.log("\n=== Finding 5: closeness of the CALIBRATED pick (margin from 50) by DQ bucket -- are high-DQ matches inherently closer contests? ===");
  for (const [min, max, label] of buckets) {
    const inBucket = entries.filter((e) => e.dataQuality >= min && e.dataQuality < max && e.row.calibratedProbability !== null);
    if (inBucket.length === 0) continue;
    const margins = inBucket.map((e) => Math.abs(e.row.calibratedProbability! - 50));
    const avgMargin = margins.reduce((s, m) => s + m, 0) / margins.length;
    console.log(`  DQ ${label} (n=${inBucket.length}): avgMarginFrom50=${avgMargin.toFixed(1)}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
