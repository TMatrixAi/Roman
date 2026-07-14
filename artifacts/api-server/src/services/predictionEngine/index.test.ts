import test from "node:test";
import assert from "node:assert/strict";
import { runPredictionEngine } from "./index";
import type { PredictionEngineInput } from "./types";
import type { PlayerProfile, MatchRecord } from "../tennisData/types";

/**
 * Contradiction-check suite (Step 2 of the 2026-07-13 upsetRisk.ts labeling task): runs the REAL
 * engine end-to-end and asserts a handful of cross-field invariants that `checkFinalConsistency`
 * doesn't cover on its own because they depend on the free-form `reasons`/`risks` text rather than
 * a single typed field. Anything `checkFinalConsistency` already checks (recommendation vs. Elite,
 * disagreement/model-conflict notes vs. their flags, set-score direction, etc.) is asserted
 * implicitly here too via `output.engine.consistencyViolations` -- see finalConsistencyCheck.ts
 * and finalConsistencyCheck.test.ts for the exhaustive per-rule unit tests.
 */

function player(id: string, name: string, tour: "ATP" | "WTA" = "ATP"): PlayerProfile {
  return { id, name, countryCode: "US", currentRank: 40, tour, age: 26, plays: "Right-handed", fullName: name };
}

function match(opponentId: string, opponentName: string, won: boolean, surface: "Hard" | "Clay" | "Grass", daysAgo: number, servicePointsWonPct: number): MatchRecord {
  const date = new Date(Date.now());
  date.setDate(date.getDate() - daysAgo);
  return {
    id: `m-${opponentId}-${daysAgo}`,
    date: date.toISOString().slice(0, 10),
    tournamentName: "Fixture Open",
    tournamentLevel: "ATP250",
    round: "R32",
    matchFormat: "BestOf3",
    surface,
    indoor: false,
    opponentId,
    opponentName,
    opponentRank: 60,
    result: won ? "W" : "L",
    score: won ? "6-3 6-4" : "3-6 4-6",
    retired: false,
    walkover: false,
    stats: { firstServePct: 62, firstServeWon: 70, secondServeWon: 50, aces: 5, doubleFaults: 2, breakPointsSaved: 60, breakPointsFaced: 5, returnPointsWon: 38, servicePointsWonPct },
    opponentStats: null,
    setGameMargins: won ? [{ playerGames: 6, opponentGames: 3 }, { playerGames: 6, opponentGames: 4 }] : [{ playerGames: 3, opponentGames: 6 }, { playerGames: 4, opponentGames: 6 }],
  };
}

function baseInput(overrides: Partial<PredictionEngineInput> = {}): PredictionEngineInput {
  const player1 = player("p1", "Player One");
  const player2 = player("p2", "Player Two");
  return {
    player1,
    player2,
    player1Matches: Array.from({ length: 8 }, (_, i) => match(`opp1-${i}`, `Opp1-${i}`, i % 4 !== 0, "Hard", 10 + i * 10, 65)),
    player2Matches: Array.from({ length: 8 }, (_, i) => match(`opp2-${i}`, `Opp2-${i}`, i % 3 === 0, "Hard", 12 + i * 10, 52)),
    headToHead: { player1Id: player1.id, player2Id: player2.id, meetings: [] },
    surface: "Hard",
    matchFormat: "BestOf3",
    tournamentName: "Fixture Open",
    weather: null,
    segment: null,
    simulatorAdoption: null,
    activeCalibration: null,
    ...overrides,
  };
}

// Regression test for Task #111: before this fix, `moduleEdges` was filtered by
// `EXCLUDED_FROM_ENSEMBLE` (availability/fatigue/matchLoadRecovery) BEFORE the Data Quality blend
// ever saw it, so those three modules -- despite having real, documented `MODULE_IMPORTANCE`
// weights and rationale -- silently never contributed to `dataQuality` at all. Ablating them via
// `excludedModels` must now visibly move the score, proving the blend actually reads them.
test("availability/fatigue/matchLoadRecovery genuinely contribute to Data Quality (Task #111 root-cause fix), even though all three are excluded from the ensemble vote", () => {
  const withAllModules = runPredictionEngine(baseInput());
  const withoutThoseThree = runPredictionEngine(baseInput({ excludedModels: new Set(["availability", "fatigue", "matchLoadRecovery"]) }));

  assert.notEqual(
    withAllModules.dataQuality,
    withoutThoseThree.dataQuality,
    "ablating availability/fatigue/matchLoadRecovery must change the Data Quality score if they are genuinely part of the blend",
  );

  // Their exclusion from the ensemble VOTE itself must be completely unaffected by this fix --
  // the predicted probability should be identical whether or not the Data-Quality-only ablation
  // above changes anything (those three never voted either way).
  assert.equal(
    withAllModules.rawEnsembleProbability,
    withoutThoseThree.rawEnsembleProbability,
    "excludedModels ablation of non-voting modules must not accidentally change the ensemble's predicted probability",
  );
});

test("the final-consistency guard runs automatically on every real engine output and records zero violations for well-formed inputs", () => {
  const output = runPredictionEngine(baseInput());
  assert.deepEqual(output.engine.consistencyViolations, [], "a normal, well-formed prediction must never trip any contradiction rule");
});

test("a 'Surface Elo favors X' reason always names whichever player actually holds the HIGHER surface Elo rating, never the lower one", () => {
  const output = runPredictionEngine(baseInput());
  const surfaceEloReason = output.engine.reasons.find((r) => r.startsWith("Surface Elo favors"));
  if (!surfaceEloReason) return; // sample size too thin to have a surfaceElo reason at all -- nothing to check
  const { player1SurfaceElo, player2SurfaceElo } = output.engine.surfaceElo;
  const expectedFavored = player1SurfaceElo >= player2SurfaceElo ? output.engine.surfaceElo : null;
  const namedPlayer1 = surfaceEloReason.includes("Player One");
  const actuallyHigherIsPlayer1 = player1SurfaceElo >= player2SurfaceElo;
  assert.equal(namedPlayer1, actuallyHigherIsPlayer1, `reason "${surfaceEloReason}" must name the player with the higher rating (P1=${player1SurfaceElo}, P2=${player2SurfaceElo})`);
  void expectedFavored;
});

test("the predicted winner's projected set score never implies they lose the match, when player 1 is favored", () => {
  const output = runPredictionEngine(baseInput());
  assert.equal(output.predictedWinnerId, "p1", "sanity check: this fixture must actually favor player 1");
  const [winnerSets, loserSets] = output.predictedSetScore.split("-").map(Number);
  assert.ok(winnerSets > loserSets, `predictedSetScore "${output.predictedSetScore}" must show the winner (listed first) ahead`);
});

// Regression test for a live bug found 2026-07-13 (a user directly asked us to prove the fix,
// which surfaced that the original `predictSetScore` swapped which literal came first based on
// `favorsPlayer1` -- that's player-1-first ordering, NOT winner-first ordering, so any prediction
// favoring player 2 rendered a set score that looked like the winner lost (e.g. "0-2" printed
// directly under the winner's own name in the UI, with no player labels). This exact case was
// invisible to the "player 1 favored" test above, which is why it shipped in the first place --
// always test the swapped-favorite direction explicitly, not just the default/happy path.
test("the predicted winner's projected set score never implies they lose the match, when player 2 is favored (regression: this exact case shipped a live bug)", () => {
  const output = runPredictionEngine(
    baseInput({
      player1Matches: Array.from({ length: 8 }, (_, i) => match(`opp1-${i}`, `Opp1-${i}`, i % 3 === 0, "Hard", 12 + i * 10, 52)),
      player2Matches: Array.from({ length: 8 }, (_, i) => match(`opp2-${i}`, `Opp2-${i}`, i % 4 !== 0, "Hard", 10 + i * 10, 65)),
    }),
  );
  assert.equal(output.predictedWinnerId, "p2", "sanity check: this fixture must actually favor player 2");
  const [winnerSets, loserSets] = output.predictedSetScore.split("-").map(Number);
  assert.ok(winnerSets > loserSets, `predictedSetScore "${output.predictedSetScore}" must show the winner (listed first) ahead even when player 2 is the pick`);
});

// Regression test for Task #61 (see ../evaluation/SIMULATOR_VS_ENSEMBLE_DISAGREEMENT.md): a
// simulator validated on AVERAGE logLoss must not still get outsized influence on a specific
// match where its two visible signals (Surface Elo, Serve & Return) are much less reliable than a
// signal it structurally cannot see (here, Recent Form). Both players have only a single match on
// the upcoming surface (Hard) but a full recent-form window pooled across all surfaces, so Surface
// Elo's reliability is thin while Recent Form's is high -- exactly the scope-mismatch profile
// documented in the investigation doc.
test("the simulator's per-match blend weight is scaled down when its own signals are far less reliable than a signal it can't see", () => {
  const player1 = player("p1", "Player One");
  const player2 = player("p2", "Player Two");
  const thinHardPlusDeepClay = (prefix: string, winRatio: number) => [
    match(`${prefix}-hard-opp`, `${prefix} Hard Opp`, true, "Hard", 5, 65),
    ...Array.from({ length: 8 }, (_, i) => match(`${prefix}-clay-${i}`, `${prefix} Clay Opp ${i}`, i % 3 !== (winRatio > 0.5 ? 3 : 0), "Clay", 20 + i * 10, 55)),
  ];

  const input: PredictionEngineInput = {
    player1,
    player2,
    player1Matches: thinHardPlusDeepClay("p1", 0.7),
    player2Matches: thinHardPlusDeepClay("p2", 0.3),
    headToHead: { player1Id: player1.id, player2Id: player2.id, meetings: [] },
    surface: "Hard",
    matchFormat: "BestOf3",
    tournamentName: "Fixture Open",
    weather: null,
    segment: null,
    // A simulator globally validated with a healthy 40% weight -- the scenario this test exists
    // to guard against is this weight being applied uniformly regardless of per-match scope fit.
    simulatorAdoption: { adopted: true, weight: 0.4, sampleSize: 60, minSampleSize: 30, note: "Validated on 60 real graded outcomes: simulator beats the ensemble on average." },
    activeCalibration: null,
  };

  const output = runPredictionEngine(input);
  const { surfaceElo, recentForm } = output.engine;
  assert.ok(recentForm.reliability - surfaceElo.reliability >= 30, `fixture must actually reproduce a real reliability gap (surfaceElo=${surfaceElo.reliability}, recentForm=${recentForm.reliability})`);

  const simulatorVote = output.engine.models.find((m) => m.modelName === "Monte Carlo Simulator");
  const appliedWeight = simulatorVote?.weightUsed ?? 0;
  assert.ok(appliedWeight < 0.4, `simulator's per-match weight (${appliedWeight}) must be scaled down below its globally-validated weight (0.4) when it's blind to a much more reliable signal (Recent Form, reliability=${recentForm.reliability}) vs. its own (${surfaceElo.reliability})`);
});

test("the Monte Carlo simulator's reliability figure is never shown as if it were a passed validation score while the simulator is still unvalidated/display-only", () => {
  const output = runPredictionEngine(baseInput());
  if (!output.engine.simulatorApplied) {
    // Unvalidated/display-only: the note must say so plainly rather than silently showing a
    // reliability number that could be mistaken for "this has been validated".
    assert.match(
      output.engine.simulatorNote,
      /not.{0,40}(validated|voted)|transparency only/i,
      "simulatorNote must disclose that the simulator isn't voting/validated when simulatorApplied is false",
    );
  }
});
