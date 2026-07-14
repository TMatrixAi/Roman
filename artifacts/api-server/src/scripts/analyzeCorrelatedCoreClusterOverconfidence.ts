// Diagnostic for Task #146 ("Stop correlated modules from double-counting the same evidence"):
// Surface Elo, Serve & Return, and Recent Form all derive their edges from largely the same
// underlying recent-match history for each player. `computeWeightedDisagreement` (disagreement.ts)
// and `computeEliteTier`'s "all three signals agree" gate (eliteTier.ts) both currently treat
// agreement among these three as if it came from three independently-informative modules, which
// structurally inflates `modelAgreement` ("Strong"), suppresses NO_STRONG_SIGNAL, and grants Elite
// Tier eligibility whenever the shared underlying data happens to point one direction -- whether
// or not any of the other, genuinely more independent modules (Fatigue, Head-to-Head,
// Availability, Match Load Recovery) agree at all.
//
// This script recomputes, from already-stored real graded rows (no new walk-forward run --
// re-running that suite wipes history, see Task #135), what fraction of "all three core signals
// agree" cases are driven ONLY by the correlated trio (no other module meaningfully agrees), and
// compares real calibration (accuracy, log loss, ECE) between that "trio-only" cohort and the
// "broad agreement" cohort where at least one genuinely independent module also concurs -- the
// direct test of whether the trio's agreement is being over-trusted relative to real outcomes.
//
// Usage: pnpm --filter @workspace/api-server exec tsx src/scripts/analyzeCorrelatedCoreClusterOverconfidence.ts
import { db, evaluationPredictionsTable, pool, type EvaluationPredictionRow } from "@workspace/db";
import { and, inArray } from "drizzle-orm";
import { computeSegmentMetrics } from "../services/evaluation/metrics";
import type { LiveFeatureSnapshot } from "../services/evaluation/types";
import type { EngineBreakdown } from "../services/predictionEngine";
import type { ModelVote } from "../services/predictionEngine/ensemble";

const CORE_TRIO = ["Surface Elo", "Serve & Return", "Recent Form"];
// Fatigue/Availability/Match Load Recovery are excluded from the ensemble VOTE (see
// `EXCLUDED_FROM_ENSEMBLE` in dataQuality.ts) so they never appear in `engine.models` at all --
// Head-to-Head is the only genuinely-independent module that actually votes alongside the trio.
const INDEPENDENT_MODULES = ["Head-to-Head"];
const MEANINGFUL_WEIGHT_SHARE = 0.15;

function extractEngine(row: EvaluationPredictionRow): EngineBreakdown | null {
  const snapshot = row.featureSnapshot as unknown as Partial<LiveFeatureSnapshot> | null;
  const engine = snapshot?.engine as EngineBreakdown | undefined;
  if (!engine || !Array.isArray(engine.models)) return null;
  return engine;
}

function favorsPlayer1(models: ModelVote[], name: string): boolean | null {
  const vote = models.find((m) => m.modelName === name);
  return vote ? vote.player1Probability >= 50 : null;
}

function meaningfulShare(models: ModelVote[], name: string): boolean {
  const totalWeight = models.reduce((sum, m) => sum + m.weightUsed, 0);
  const vote = models.find((m) => m.modelName === name);
  return !!vote && totalWeight > 0 && vote.weightUsed / totalWeight >= MEANINGFUL_WEIGHT_SHARE;
}

async function fetchRows(): Promise<EvaluationPredictionRow[]> {
  return db
    .select()
    .from(evaluationPredictionsTable)
    .where(
      and(
        inArray(evaluationPredictionsTable.runKind, ["historical_test", "paper_trade", "live"]),
        inArray(evaluationPredictionsTable.status, ["graded", "void"]),
      ),
    );
}

async function main(): Promise<void> {
  const allRows = await fetchRows();
  const rows = allRows.filter((r) => (r.runKind === "historical_test" ? r.segment === "test" : true));
  console.log(`Total genuinely-unseen graded/void rows: ${rows.length}`);

  const withEngine = rows
    .map((r) => ({ row: r, engine: extractEngine(r) }))
    .filter((x): x is { row: EvaluationPredictionRow; engine: EngineBreakdown } => x.engine !== null);
  console.log(`Rows with a stored engine breakdown: ${withEngine.length}`);

  // Real correlation check: how often do the trio's raw directions actually move together, vs a
  // genuinely independent module (Fatigue/Head-to-Head)?
  let trioAllAgreeCount = 0;
  let trioPairwiseAgreeCount = 0;
  let trioPairwiseTotal = 0;
  let h2hAgreesWithTrioMajority = 0;
  let h2hComparableTotal = 0;
  for (const { engine } of withEngine) {
    const dirs = CORE_TRIO.map((n) => favorsPlayer1(engine.models, n)).filter((d): d is boolean => d !== null);
    if (dirs.length === 3) {
      if (dirs.every((d) => d === dirs[0])) trioAllAgreeCount++;
      for (let i = 0; i < dirs.length; i++) {
        for (let j = i + 1; j < dirs.length; j++) {
          trioPairwiseTotal++;
          if (dirs[i] === dirs[j]) trioPairwiseAgreeCount++;
        }
      }
      const majority = dirs.filter((d) => d).length >= 2;
      const h2hDir = favorsPlayer1(engine.models, "Head-to-Head");
      if (h2hDir !== null) {
        h2hComparableTotal++;
        if (h2hDir === majority) h2hAgreesWithTrioMajority++;
      }
    }
  }
  console.log(`\nTrio all-3-agree rate: ${((trioAllAgreeCount / withEngine.length) * 100).toFixed(1)}% (n=${withEngine.length})`);
  console.log(`Trio pairwise same-direction rate: ${((trioPairwiseAgreeCount / trioPairwiseTotal) * 100).toFixed(1)}% (n=${trioPairwiseTotal} pairs) -- chance alone would be ~50%`);
  console.log(
    `Head-to-Head agrees with trio majority direction: ${((h2hAgreesWithTrioMajority / h2hComparableTotal) * 100).toFixed(1)}% (n=${h2hComparableTotal}) -- a genuinely independent module should track closer to 50% if the trio's agreement isn't just shared data`,
  );

  // Calibration comparison: "trio-only agreement" (all 3 agree, but no other meaningfully-weighted
  // module also agrees) vs "broad agreement" (all 3 agree AND at least one independent module with
  // meaningful weight also points the same way).
  const trioOnlyRows: EvaluationPredictionRow[] = [];
  const broadAgreementRows: EvaluationPredictionRow[] = [];
  const trioDisagreeRows: EvaluationPredictionRow[] = [];

  for (const { row, engine } of withEngine) {
    const dirs = CORE_TRIO.map((n) => favorsPlayer1(engine.models, n));
    if (dirs.some((d) => d === null)) continue;
    const allAgree = dirs.every((d) => d === dirs[0]);
    if (!allAgree) {
      trioDisagreeRows.push(row);
      continue;
    }
    const trioDirection = dirs[0];
    const independentAgrees = INDEPENDENT_MODULES.some((name) => {
      if (!meaningfulShare(engine.models, name)) return false;
      return favorsPlayer1(engine.models, name) === trioDirection;
    });
    if (independentAgrees) broadAgreementRows.push(row);
    else trioOnlyRows.push(row);
  }

  console.log(`\nTrio-only agreement (n=${trioOnlyRows.length}):`, JSON.stringify(computeSegmentMetrics(trioOnlyRows), null, 2));
  console.log(`\nBroad agreement, trio + independent module (n=${broadAgreementRows.length}):`, JSON.stringify(computeSegmentMetrics(broadAgreementRows), null, 2));
  console.log(`\nTrio internally disagrees (n=${trioDisagreeRows.length}):`, JSON.stringify(computeSegmentMetrics(trioDisagreeRows), null, 2));

  // Direct read on today's Elite/Strong-agreement gate: among rows where the ONLY thing driving
  // "Strong" modelAgreement is the correlated trio (no meaningfully-weighted independent module
  // even present/agreeing), what's real accuracy/log loss vs the broad-agreement cohort?
  const strongTrioOnly = trioOnlyRows.filter((r) => {
    const engine = extractEngine(r);
    return engine?.modelAgreement === "Strong";
  });
  const strongBroad = broadAgreementRows.filter((r) => {
    const engine = extractEngine(r);
    return engine?.modelAgreement === "Strong";
  });
  console.log(`\n"Strong" agreement, trio-only-driven (n=${strongTrioOnly.length}):`, JSON.stringify(computeSegmentMetrics(strongTrioOnly), null, 2));
  console.log(`"Strong" agreement, broad-driven (n=${strongBroad.length}):`, JSON.stringify(computeSegmentMetrics(strongBroad), null, 2));

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
