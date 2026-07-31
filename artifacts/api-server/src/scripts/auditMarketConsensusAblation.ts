/**
 * Market Consensus ablation analysis — Task #21.
 *
 * WHY A DEDICATED SCRIPT (NOT THE STANDARD ablation.ts FRAMEWORK):
 * The standard ablation runner (services/evaluation/ablation.ts) works exclusively on the
 * historical match corpus and never passes `input.marketOdds` to `scoreMatch()`. Because the
 * Market Consensus module ONLY fires when `input.marketOdds != null`, the "ablate_marketOdds"
 * leave-one-out variant in the standard runner is always identical to baseline — the module was
 * never active in the first place. A standard run would produce a meaningless delta of exactly
 * 0.0pp and tell us nothing about whether the module earns its place.
 *
 * The correct data source is `evaluation_predictions` paper_trade rows where real market odds
 * were locked at cutoff time (odds_player1_decimal IS NOT NULL). For each such row we can:
 *   (A) Read the stored calibrated_probability — this IS the "with market odds" prediction,
 *       because the engine was run with the real odds when the row was locked.
 *   (B) Re-run the same prediction WITHOUT market odds by replaying the historical feature
 *       inputs through the engine with excludedModels = {"marketOdds"}.
 * Comparing (A) vs (B) gives a clean, apples-to-apples view of exactly what the module does to
 * accuracy and log-loss — on real, independently graded outcomes.
 *
 * ADDITIONAL ANALYSIS — market direction alignment:
 * Even on rows where we can't re-run the engine (e.g. player IDs not in the historical corpus),
 * we can still ask: "when the market's implied probability agreed with the model's pick, did that
 * increase accuracy? When it disagreed, was the model actually wrong?" This doesn't require
 * re-running the engine and uses purely stored columns.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/auditMarketConsensusAblation.ts
 */

import { db, evaluationPredictionsTable, historicalMatchesTable, calibrationModelsTable, specialistModelsTable, pool } from "@workspace/db";
import { and, isNotNull, eq, asc } from "drizzle-orm";
import { runPredictionEngine } from "../services/predictionEngine";
import { buildMatchHistoryIndex, reconstructPlayerMatchHistory, reconstructHeadToHead } from "../services/historicalData/matchRecordReconstruction";
import { buildEloHistoryIndex, resolveOpponentStrengthFromIndex } from "../services/predictionEngine/opponentStrength";
import { resolveSegment } from "../services/predictionEngine/segments";
import { applyCalibration } from "../services/evaluation/calibration";
import type { AblationModelKey, SegmentSpecialistInput } from "../services/predictionEngine/types";
import type { CalibrationKnot } from "../services/evaluation/types";
import type { Surface, MatchFormat } from "../services/tennisData/types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GradedOddsRow {
  id: number;
  runKind: string;
  player1Id: string;
  player1Name: string;
  player2Id: string;
  player2Name: string;
  surface: string | null;
  matchFormat: string | null;
  tournamentName: string | null;
  tournamentLevel: string | null;
  cutoffAt: Date;
  scheduledStartAt: Date;
  rawProbability: number | null;
  calibratedProbability: number | null;
  predictedWinnerId: string | null;
  actualWinnerId: string | null;
  includedInAccuracy: boolean | null;
  oddsPlayer1Decimal: number | null;
  oddsPlayer2Decimal: number | null;
  impliedProbability: number | null;
  marketEdge: number | null;
}

interface PairResult {
  rowId: number;
  actualWinnerId: string;
  predictedWinnerId: string; // with market odds (stored)
  noOddsPredictedWinnerId: string; // without market odds (re-run)
  withOddsProb: number; // calibrated probability for player1, with odds (stored)
  noOddsProb: number; // calibrated probability for player1, without odds (re-run)
  correctWithOdds: boolean;
  correctWithoutOdds: boolean;
  player1Id: string;
  tour: string | null;
  surface: string | null;
}

// ─── Log-loss helper ─────────────────────────────────────────────────────────

function logLoss(prob: number, correct: boolean): number {
  const p = Math.min(Math.max(prob / 100, 1e-6), 1 - 1e-6);
  return correct ? -Math.log(p) : -Math.log(1 - p);
}

function accuracy(rows: { correct: boolean }[]): number | null {
  if (rows.length === 0) return null;
  return Math.round((rows.filter((r) => r.correct).length / rows.length) * 1000) / 10;
}

function avgLogLoss(rows: { logLoss: number }[]): number | null {
  if (rows.length === 0) return null;
  return Math.round((rows.reduce((s, r) => s + r.logLoss, 0) / rows.length) * 10000) / 10000;
}

function pct(n: number, total: number): string {
  if (total === 0) return "n/a";
  return `${Math.round((n / total) * 1000) / 10}%`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Market Consensus Module Ablation (Task #21) ===\n");

  // 1. Load graded paper_trade rows with market odds attached
  console.log("Loading graded paper_trade rows with market odds...");
  // Restrict to paper_trade rows ONLY. Market odds are locked at real prediction time for
  // paper_trade rows — the engine saw real live odds before the match started, so these are the
  // only rows where "with market odds" vs "without market odds" reflects a genuine real-world
  // counterfactual. historical_test rows never have odds; paper_trade_shadow rows use a simulated
  // lock window and are explicitly excluded from standard accuracy comparisons.
  const rawRows = await db
    .select({
      id: evaluationPredictionsTable.id,
      runKind: evaluationPredictionsTable.runKind,
      player1Id: evaluationPredictionsTable.player1Id,
      player1Name: evaluationPredictionsTable.player1Name,
      player2Id: evaluationPredictionsTable.player2Id,
      player2Name: evaluationPredictionsTable.player2Name,
      surface: evaluationPredictionsTable.surface,
      matchFormat: evaluationPredictionsTable.matchFormat,
      tournamentName: evaluationPredictionsTable.tournamentName,
      tournamentLevel: evaluationPredictionsTable.tournamentLevel,
      cutoffAt: evaluationPredictionsTable.cutoffAt,
      scheduledStartAt: evaluationPredictionsTable.scheduledStartAt,
      rawProbability: evaluationPredictionsTable.rawProbability,
      calibratedProbability: evaluationPredictionsTable.calibratedProbability,
      predictedWinnerId: evaluationPredictionsTable.predictedWinnerId,
      actualWinnerId: evaluationPredictionsTable.actualWinnerId,
      includedInAccuracy: evaluationPredictionsTable.includedInAccuracy,
      oddsPlayer1Decimal: evaluationPredictionsTable.oddsPlayer1Decimal,
      oddsPlayer2Decimal: evaluationPredictionsTable.oddsPlayer2Decimal,
      impliedProbability: evaluationPredictionsTable.impliedProbability,
      marketEdge: evaluationPredictionsTable.marketEdge,
    })
    .from(evaluationPredictionsTable)
    .where(
      and(
        eq(evaluationPredictionsTable.runKind, "paper_trade"),
        eq(evaluationPredictionsTable.status, "graded"),
        isNotNull(evaluationPredictionsTable.oddsPlayer1Decimal),
        isNotNull(evaluationPredictionsTable.actualWinnerId),
      ),
    );

  const oddsRows: GradedOddsRow[] = rawRows as GradedOddsRow[];
  console.log(`  Total graded rows with market odds: ${oddsRows.length}`);

  const accuracyEligible = oddsRows.filter((r) => r.includedInAccuracy === true);
  console.log(`  Accuracy-eligible subset: ${accuracyEligible.length}`);

  // ─── SECTION A: Market Direction Analysis (no engine re-run needed) ───────

  console.log("\n--- SECTION A: Market Direction vs. Model Agreement ---");
  console.log("(Uses stored implied_probability and calibrated_probability only)\n");

  const withBothProbs = accuracyEligible.filter(
    (r) =>
      r.calibratedProbability !== null &&
      r.predictedWinnerId !== null &&
      r.impliedProbability !== null &&
      r.oddsPlayer1Decimal !== null &&
      r.oddsPlayer2Decimal !== null,
  );

  console.log(`Rows with all required columns: ${withBothProbs.length}`);

  if (withBothProbs.length > 0) {
    // "Market agrees with model" = market's implied winner is the same as model's predicted winner
    const marketAgreesRows = withBothProbs.filter((r) => {
      const marketFavorsP1 = r.impliedProbability! >= 50;
      const modelFavorsP1 = r.predictedWinnerId === r.player1Id;
      return marketFavorsP1 === modelFavorsP1;
    });
    const marketDisagreesRows = withBothProbs.filter((r) => {
      const marketFavorsP1 = r.impliedProbability! >= 50;
      const modelFavorsP1 = r.predictedWinnerId === r.player1Id;
      return marketFavorsP1 !== modelFavorsP1;
    });

    const agreesCorrect = marketAgreesRows.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;
    const disagreesCorrect = marketDisagreesRows.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;

    console.log(`Market AGREES with model:    n=${marketAgreesRows.length}, model accuracy=${pct(agreesCorrect, marketAgreesRows.length)}`);
    console.log(`Market DISAGREES with model: n=${marketDisagreesRows.length}, model accuracy=${pct(disagreesCorrect, marketDisagreesRows.length)}`);

    if (marketDisagreesRows.length > 0) {
      // When market disagrees, how often was the MARKET actually right (model wrong)?
      const marketRightWhenDisagrees = marketDisagreesRows.filter((r) => r.predictedWinnerId !== r.actualWinnerId).length;
      console.log(`  → When market disagrees: market was correct ${pct(marketRightWhenDisagrees, marketDisagreesRows.length)} of the time`);
      console.log(`    (Model was correct ${pct(disagreesCorrect, marketDisagreesRows.length)} — if market > model here, it adds value)`);
    }

    // Market edge analysis: positive edge = model saw value the market missed
    const withEdge = withBothProbs.filter((r) => r.marketEdge !== null);
    if (withEdge.length > 0) {
      const positiveEdgeRows = withEdge.filter((r) => r.marketEdge! > 0);
      const negativeEdgeRows = withEdge.filter((r) => r.marketEdge! <= 0);
      const posCorrect = positiveEdgeRows.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;
      const negCorrect = negativeEdgeRows.filter((r) => r.predictedWinnerId === r.actualWinnerId).length;

      console.log(`\nMarket EDGE analysis (n=${withEdge.length}):`);
      console.log(`  Positive edge (model sees value vs market): n=${positiveEdgeRows.length}, accuracy=${pct(posCorrect, positiveEdgeRows.length)}`);
      console.log(`  Negative edge (market MORE confident than model): n=${negativeEdgeRows.length}, accuracy=${pct(negCorrect, negativeEdgeRows.length)}`);
    }
  }

  // ─── SECTION B: Engine Re-run Ablation ───────────────────────────────────

  console.log("\n--- SECTION B: Engine Re-run Ablation (with vs. without market odds) ---\n");

  const reRunCandidates = accuracyEligible.filter(
    (r) =>
      r.surface !== null &&
      r.matchFormat !== null &&
      r.predictedWinnerId !== null &&
      r.calibratedProbability !== null &&
      r.oddsPlayer1Decimal !== null &&
      r.oddsPlayer2Decimal !== null,
  );

  console.log(`Candidates for re-run (have surface + format + odds): ${reRunCandidates.length}`);

  if (reRunCandidates.length === 0) {
    console.log("No candidates for engine re-run — section B skipped.");
  } else {
    // Load the full historical corpus and build indexes (same as ablation.ts buildContext)
    console.log("Building historical context (this may take a moment)...");
    const allMatches = await db
      .select()
      .from(historicalMatchesTable)
      .orderBy(asc(historicalMatchesTable.scheduledStartAt), asc(historicalMatchesTable.id));

    const matchHistory = buildMatchHistoryIndex(allMatches);
    const eloHistory = await buildEloHistoryIndex();

    // Active calibration
    const [activeCalibrationRow] = await db
      .select()
      .from(calibrationModelsTable)
      .where(eq(calibrationModelsTable.active, true))
      .limit(1);
    const activeCalibration: CalibrationKnot[] | null = activeCalibrationRow
      ? (activeCalibrationRow.mapping as CalibrationKnot[])
      : null;

    // Specialist models
    const specialistRows = await db.select().from(specialistModelsTable);
    const segmentBySegmentKey = new Map<string, SegmentSpecialistInput>();
    for (const row of specialistRows) {
      segmentBySegmentKey.set(row.segmentKey, {
        segmentKey: row.segmentKey,
        label: row.label,
        meetsThreshold: row.meetsThreshold,
        historicalMatchCount: row.historicalMatchCount,
        validationSampleSize: row.validationSampleSize,
        minHistoricalMatches: 0,
        minValidationSamples: 0,
        calibrationMapping: row.meetsThreshold ? (row.calibrationMapping as CalibrationKnot[]) : undefined,
        weight: row.meetsThreshold ? row.weight : undefined,
      });
    }

    console.log(`Historical corpus: ${allMatches.length} matches. Running ablation pairs...\n`);

    const pairs: PairResult[] = [];
    let skipped = 0;
    let noHistory = 0;

    const EXCLUDED_MARKET: ReadonlySet<AblationModelKey> = new Set(["marketOdds"]);

    for (let i = 0; i < reRunCandidates.length; i++) {
      const row = reRunCandidates[i];
      if (i > 0 && i % 50 === 0) console.log(`  Processed ${i}/${reRunCandidates.length}...`);

      // Reconstruct player match histories using the cutoffAt as the leak-proof boundary
      const p1Matches = reconstructPlayerMatchHistory(matchHistory, row.player1Id, row.cutoffAt);
      const p2Matches = reconstructPlayerMatchHistory(matchHistory, row.player2Id, row.cutoffAt);

      if (p1Matches.length === 0 || p2Matches.length === 0) {
        noHistory++;
        continue;
      }

      const p1OpponentStrength = resolveOpponentStrengthFromIndex(p1Matches, eloHistory);
      const p2OpponentStrength = resolveOpponentStrengthFromIndex(p2Matches, eloHistory);
      const headToHead = reconstructHeadToHead(matchHistory, row.player1Id, row.player2Id, row.cutoffAt);

      const surface = row.surface as Surface;
      const matchFormat = row.matchFormat as MatchFormat;
      const tour = (() => {
        // Infer tour from player history (same heuristic the walk-forward runner uses)
        const levels = p1Matches.map((m) => m.tournamentLevel).filter(Boolean) as string[];
        if (levels.some((l) => l.startsWith("ATP") || l === "GrandSlam" || l === "Masters1000")) return "ATP";
        if (levels.some((l) => l.startsWith("WTA"))) return "WTA";
        return null;
      })();

      const segmentDef = resolveSegment(tour, surface);
      const segment = segmentDef ? (segmentBySegmentKey.get(segmentDef.segmentKey) ?? null) : null;

      const playerProfile = (id: string, name: string) => ({
        id,
        name,
        countryCode: null,
        currentRank: null,
        tour: null,
        age: null,
        plays: null,
        fullName: null,
      });

      const commonInput = {
        player1: playerProfile(row.player1Id, row.player1Name),
        player2: playerProfile(row.player2Id, row.player2Name),
        player1Matches: p1Matches,
        player2Matches: p2Matches,
        headToHead,
        surface,
        matchFormat,
        player1OpponentElo: p1OpponentStrength.lookup,
        player2OpponentElo: p2OpponentStrength.lookup,
        tournamentName: row.tournamentName,
        weather: null,
        segment,
        simulatorAdoption: null,
        activeCalibration,
        asOfDate: row.cutoffAt,
      };

      let withOddsOutput: ReturnType<typeof runPredictionEngine>;
      let noOddsOutput: ReturnType<typeof runPredictionEngine>;

      try {
        // "With market odds": pass the stored odds AND an explicit empty excludedModels so the
        // engine knows this is an ablation call and bypasses the global EXCLUDED_FROM_ENSEMBLE gate
        // (which blocks the market module on all live calls until the ≥200 sample bar is cleared).
        withOddsOutput = runPredictionEngine({
          ...commonInput,
          marketOdds: {
            provider: "replay",
            player1DecimalOdds: row.oddsPlayer1Decimal!,
            player2DecimalOdds: row.oddsPlayer2Decimal!,
            fetchedAt: row.cutoffAt.toISOString(),
          },
          excludedModels: new Set(), // empty set = ablation mode: bypass EXCLUDED_FROM_ENSEMBLE
        });
        // "Without market odds": explicitly exclude the market module
        noOddsOutput = runPredictionEngine({
          ...commonInput,
          excludedModels: EXCLUDED_MARKET,
        });
      } catch {
        skipped++;
        continue;
      }

      const player1Id = row.player1Id;
      const correctWithOdds = withOddsOutput.predictedWinnerId === row.actualWinnerId;
      const correctWithoutOdds = noOddsOutput.predictedWinnerId === row.actualWinnerId;

      pairs.push({
        rowId: row.id,
        actualWinnerId: row.actualWinnerId!,
        predictedWinnerId: withOddsOutput.predictedWinnerId,
        noOddsPredictedWinnerId: noOddsOutput.predictedWinnerId,
        withOddsProb: withOddsOutput.calibratedProbability,
        noOddsProb: noOddsOutput.calibratedProbability,
        correctWithOdds,
        correctWithoutOdds,
        player1Id,
        tour,
        surface: row.surface,
      });
    }

    console.log(`\n  Re-run complete. Skipped (no history): ${noHistory}. Skipped (engine error): ${skipped}. Paired: ${pairs.length}.`);

    if (pairs.length > 0) {
      const withOddsAccuracy = accuracy(pairs.map((p) => ({ correct: p.correctWithOdds })));
      const noOddsAccuracy = accuracy(pairs.map((p) => ({ correct: p.correctWithoutOdds })));

      // Log-loss: use player1-relative probability vs player1 actually winning
      const withOddsLL = avgLogLoss(
        pairs.map((p) => ({
          logLoss: logLoss(p.withOddsProb, p.actualWinnerId === p.player1Id),
        })),
      );
      const noOddsLL = avgLogLoss(
        pairs.map((p) => ({
          logLoss: logLoss(p.noOddsProb, p.actualWinnerId === p.player1Id),
        })),
      );

      console.log("\n  ┌─────────────────────────────────────────────────────────┐");
      console.log("  │  Market Consensus Ablation — Engine Re-run Results       │");
      console.log("  ├──────────────────────┬────────────┬──────────────────────┤");
      console.log(`  │ Variant              │ Accuracy   │ Log-Loss             │`);
      console.log("  ├──────────────────────┼────────────┼──────────────────────┤");
      console.log(`  │ With market odds      │ ${String(withOddsAccuracy).padEnd(10)} │ ${String(withOddsLL).padEnd(20)} │`);
      console.log(`  │ Without market odds   │ ${String(noOddsAccuracy).padEnd(10)} │ ${String(noOddsLL).padEnd(20)} │`);
      console.log("  └──────────────────────┴────────────┴──────────────────────┘");

      const deltaAcc = withOddsAccuracy !== null && noOddsAccuracy !== null ? Math.round((withOddsAccuracy - noOddsAccuracy) * 10) / 10 : null;
      const deltaLL = withOddsLL !== null && noOddsLL !== null ? Math.round((withOddsLL - noOddsLL) * 10000) / 10000 : null;

      console.log(`\n  Δ accuracy (with − without): ${deltaAcc !== null ? `${deltaAcc > 0 ? "+" : ""}${deltaAcc}pp` : "n/a"}`);
      console.log(`  Δ log-loss  (with − without): ${deltaLL !== null ? `${deltaLL > 0 ? "+" : ""}${deltaLL}` : "n/a"}  (negative = with-odds is BETTER)`);

      // How often did the market module actually flip the final pick?
      const flippedPicks = pairs.filter((p) => p.predictedWinnerId !== p.noOddsPredictedWinnerId);
      console.log(`\n  Pairs where market odds flipped the pick: ${flippedPicks.length}/${pairs.length} (${pct(flippedPicks.length, pairs.length)})`);

      if (flippedPicks.length > 0) {
        const flippedCorrectWithOdds = flippedPicks.filter((p) => p.correctWithOdds).length;
        const flippedCorrectWithout = flippedPicks.filter((p) => p.correctWithoutOdds).length;
        console.log(`    On flip-pairs: with-odds correct=${pct(flippedCorrectWithOdds, flippedPicks.length)}, without-odds correct=${pct(flippedCorrectWithout, flippedPicks.length)}`);
      }

      // Per-tour breakdown
      const tours = [...new Set(pairs.map((p) => p.tour ?? "Unknown"))];
      if (tours.length > 1) {
        console.log("\n  Per-tour breakdown:");
        for (const tour of tours) {
          const subset = pairs.filter((p) => (p.tour ?? "Unknown") === tour);
          const wAcc = accuracy(subset.map((p) => ({ correct: p.correctWithOdds })));
          const nAcc = accuracy(subset.map((p) => ({ correct: p.correctWithoutOdds })));
          const delta = wAcc !== null && nAcc !== null ? Math.round((wAcc - nAcc) * 10) / 10 : null;
          console.log(`    ${String(tour).padEnd(12)} n=${String(subset.length).padEnd(5)} with=${wAcc ?? "n/a"} without=${nAcc ?? "n/a"} delta=${delta !== null ? `${delta > 0 ? "+" : ""}${delta}pp` : "n/a"}`);
        }
      }

      // Per-surface breakdown
      const surfaces = [...new Set(pairs.map((p) => p.surface ?? "Unknown"))];
      if (surfaces.length > 1) {
        console.log("\n  Per-surface breakdown:");
        for (const surf of surfaces) {
          const subset = pairs.filter((p) => (p.surface ?? "Unknown") === surf);
          const wAcc = accuracy(subset.map((p) => ({ correct: p.correctWithOdds })));
          const nAcc = accuracy(subset.map((p) => ({ correct: p.correctWithoutOdds })));
          const delta = wAcc !== null && nAcc !== null ? Math.round((wAcc - nAcc) * 10) / 10 : null;
          console.log(`    ${String(surf).padEnd(12)} n=${String(subset.length).padEnd(5)} with=${wAcc ?? "n/a"} without=${nAcc ?? "n/a"} delta=${delta !== null ? `${delta > 0 ? "+" : ""}${delta}pp` : "n/a"}`);
        }
      }

      // Recommendation — task spec requires ≥200 paired paper_trade graded rows before declaring
      // a KEEP verdict. Anything below that threshold is not statistically reliable and the module
      // must remain EXCLUDED until the bar is cleared.
      console.log("\n  ─── RECOMMENDATION ───");
      if (pairs.length < 200) {
        console.log(`  ✗  EXCLUDE (n=${pairs.length} < 200 required): sample is too small to confirm net positive.`);
        console.log("     Per the task spec, market odds should remain in EXCLUDED_FROM_ENSEMBLE until ≥200 paired");
        console.log("     paper_trade rows with real odds are graded. Re-run this script when that threshold is reached.");
        if (deltaAcc !== null) {
          console.log(`     Directional signal so far: Δacc=${deltaAcc > 0 ? "+" : ""}${deltaAcc}pp, Δlog-loss=${deltaLL !== null ? (deltaLL < 0 ? "" : "+") + deltaLL : "n/a"} — promising but unconfirmed.`);
        }
      } else if (deltaAcc !== null && deltaAcc >= 0.5) {
        console.log(`  ✓  KEEP: market module improves accuracy by +${deltaAcc}pp (n=${pairs.length}). Net positive confirmed.`);
        console.log("     Remove 'marketOdds' from EXCLUDED_FROM_ENSEMBLE in dataQuality.ts.");
      } else if (deltaAcc !== null && deltaAcc <= -0.5) {
        console.log(`  ✗  EXCLUDE: market module hurts accuracy by ${deltaAcc}pp (n=${pairs.length}). Remains in EXCLUDED_FROM_ENSEMBLE.`);
      } else {
        console.log(`  ~  NEUTRAL: delta=${deltaAcc ?? "n/a"}pp (n=${pairs.length}). Too small to confirm net positive.`);
        console.log("     Per the task spec, neutral/ambiguous results keep the module in EXCLUDED_FROM_ENSEMBLE.");
      }
    }
  }

  console.log("\n=== Done ===");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
