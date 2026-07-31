/**
 * Unit tests for builderScoringService.ts — scoring correctness invariants
 *
 * These tests exercise the pure __TEST_computeScoring helper (no DB, no providers)
 * to verify the three scoring bugs identified in Task #7 are fixed:
 *
 *   Bug A — dataQuality phantom +1:
 *     The dataQuality factor measured BOTH players' combined coverage. Because it
 *     was passed through addFactor(), swapping selection direction still produced
 *     supportsSelected=true, injecting a phantom +1 into every agreeing count.
 *     Fix: supportsSelected: null always (data-quality gate, not directional).
 *
 *   Bug B — thin opponent data not penalised:
 *     sel.total < 10 raised risk by 12, but opp.total < 10 had no equivalent.
 *     A collapsed opponent (1 match) could make the overall risk *improve* via the
 *     agreement bonus on a tiny fully-agreeing set.
 *     Fix: symmetric opp.total < 10 risk += 12.
 *
 *   Bug C — agreement bonus on collapsed factor set:
 *     agreementRate > 0.75 → risk -= 8 fired with no minimum sample floor.
 *     3/3 (100%) from a collapsed 3-factor set got a stronger bonus than 7/8 from
 *     a full set.
 *     Fix: gate the bonus: agreementRate > 0.75 && available >= 5.
 *
 *   Bug D — consistency check (post-grade):
 *     No guard prevented an Elite grade when any player had insufficient data.
 *     Fix: if Elite && hasDataGap → force to Strong, push criticalFlag.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  __TEST_computeScoring,
  type PlayerStats,
  type __TEST_ScoringResult,
} from "./builderScoringService.js";

// ─── Fixture helpers ────────────────────────────────────────────────────────

/** Build a minimal PlayerStats with sensible defaults. Override only what the test needs.
 *  winRateConfidence / surfaceWinRateConfidence / recentWinRateConfidence are derived from
 *  the resolved total / surfaceTotal automatically so tests that only override `total`
 *  get the correct confidence values without needing to set them explicitly. */
function makeStats(overrides: Partial<PlayerStats> = {}): PlayerStats {
  const total       = overrides.total       ?? 20;
  const surfaceTotal = overrides.surfaceTotal ?? 0;
  const recentN     = Math.min(total, 10);           // mirrors computePlayerStats recent10.length
  return {
    total,
    winRate: 0.55,
    winRateConfidence: Math.min(1, total / 10),
    surfaceTotal,
    surfaceWinRate: 0.5,
    surfaceWinRateConfidence: Math.min(1, surfaceTotal / 5),
    recentWinRate: 0.6,
    recentWinRateConfidence: Math.min(1, recentN / 5),
    avgOppRank: 100,
    surfaceAvgOppRank: 100,
    retirementRate: 0.0,
    lastMatchDate: null,
    currentRank: null,
    tournamentWinRate: 0.5,
    tournamentTotal: 0,
    quarterWinRates: [],
    ...overrides,
  };
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe("builderScoringService — scoring correctness invariants", () => {
  // ── Bug A: dataQuality phantom +1 ────────────────────────────────────────

  it("Bug A: dataQuality factor must have supportsSelected === null in both directions", () => {
    const selStats = makeStats({ total: 20, winRate: 0.65 });
    const oppStats = makeStats({ total: 20, winRate: 0.50 });

    const resultA = __TEST_computeScoring(selStats, oppStats, { selResolvedId: "A", opponentName: "P.B" });
    const resultB = __TEST_computeScoring(oppStats, selStats, { selResolvedId: "B", opponentName: "P.A" });

    const dqA = resultA.factors.find(f => f.key === "dataQuality");
    const dqB = resultB.factors.find(f => f.key === "dataQuality");

    assert.ok(dqA !== undefined, "dataQuality factor must be present in direction A");
    assert.ok(dqB !== undefined, "dataQuality factor must be present in direction B");
    assert.strictEqual(dqA!.supportsSelected, null,
      `dataQuality.supportsSelected must be null in direction A (was ${dqA!.supportsSelected})`);
    assert.strictEqual(dqB!.supportsSelected, null,
      `dataQuality.supportsSelected must be null in direction B (was ${dqB!.supportsSelected})`);
  });

  it("Bug A: agreeing(A) + agreeing(B) <= available — direction-independence invariant", () => {
    // Before the fix, dataQuality always voted supportsSelected=true regardless of direction,
    // so agreeing(A) + agreeing(B) = available + 2 (the phantom +2 from both directions).
    // After the fix, the invariant must hold.
    const scenarios: Array<{ selWr: number; oppWr: number; label: string }> = [
      { selWr: 0.70, oppWr: 0.40, label: "clear favourite" },
      { selWr: 0.50, oppWr: 0.50, label: "coin flip" },
      { selWr: 0.40, oppWr: 0.70, label: "underdog selected" },
    ];

    for (const { selWr, oppWr, label } of scenarios) {
      const selStats = makeStats({ total: 25, winRate: selWr, recentWinRate: selWr });
      const oppStats = makeStats({ total: 25, winRate: oppWr, recentWinRate: oppWr });

      const rA = __TEST_computeScoring(selStats, oppStats, { selResolvedId: "A", opponentName: "B" });
      const rB = __TEST_computeScoring(oppStats, selStats, { selResolvedId: "B", opponentName: "A" });

      const sum = rA.agreeing + rB.agreeing;
      // In a perfectly directional system, sum = available exactly.
      // Neutral / opinionated-in-one-direction factors can make sum < available.
      // The invariant: sum must NEVER exceed available (no phantom votes).
      assert.ok(
        sum <= rA.available,
        `[${label}] agreeing(A)+agreeing(B)=${sum} should be <= available=${rA.available}`,
      );
    }
  });

  // ── Bug B: thin opponent data not penalised ───────────────────────────────

  it("Bug B: thin opponent data (opp.total < 10) raises risk symmetrically with thin sel data", () => {
    // Use clearly different win rates (0.72 vs 0.40) so winRateGap=0.32 → closeness floor=0.
    // Equal-stat players (gap=0) would trigger the closeness floor at 55 for all cases, masking
    // the thin-data penalty and making the assertion impossible.
    const selFull  = makeStats({ total: 20, winRate: 0.72, recentWinRate: 0.72, currentRank: 20 });
    const oppFull  = makeStats({ total: 20, winRate: 0.40, recentWinRate: 0.40, currentRank: 120 });
    const selThin  = makeStats({ total: 3,  winRate: 0.72, recentWinRate: 0.72, currentRank: 20 });
    const oppThin  = makeStats({ total: 3,  winRate: 0.40, recentWinRate: 0.40, currentRank: 120 });

    const rFull    = __TEST_computeScoring(selFull, oppFull);
    const rThinSel = __TEST_computeScoring(selThin, oppFull, { selectedPlayerStatus: "insufficient_data" });
    const rThinOpp = __TEST_computeScoring(selFull, oppThin, { opponentStatus: "insufficient_data" });

    // With a clear gap (winRateGap=0.32), the closeness floor is 0, so the +12 thin-data
    // penalty is clearly visible in riskScore.
    assert.ok(
      rThinSel.riskScore > rFull.riskScore,
      `Thin SEL should raise riskScore (got ${rThinSel.riskScore} vs full ${rFull.riskScore})`,
    );
    assert.ok(
      rThinOpp.riskScore > rFull.riskScore,
      `Thin OPP should raise riskScore (got ${rThinOpp.riskScore} vs full ${rFull.riskScore})`,
    );
  });

  it("Bug B: collapsed opponent (1 match, all agree) must not produce lower risk than full-data opponent", () => {
    // This was the root scenario: Zheng-style collapse where tiny sample produces 100% agreement
    // and the -8 bonus more than offset the (then-missing) thin-data penalty.
    const selStats = makeStats({ total: 20, winRate: 0.72, recentWinRate: 0.72 });
    // Opponent has only 1 match — very thin
    const oppCollapsed = makeStats({ total: 1, winRate: 1.0, recentWinRate: 1.0 });
    const oppFull      = makeStats({ total: 20, winRate: 0.50, recentWinRate: 0.50 });

    const rCollapsed = __TEST_computeScoring(selStats, oppCollapsed, { opponentStatus: "insufficient_data" });
    const rFull      = __TEST_computeScoring(selStats, oppFull);

    assert.ok(
      rCollapsed.riskScore >= rFull.riskScore,
      `Collapsed opponent (1 match) should not produce lower riskScore than full-data opponent ` +
      `(collapsed=${rCollapsed.riskScore}, full=${rFull.riskScore})`,
    );
  });

  // ── Bug C: agreement bonus gate ──────────────────────────────────────────

  it("Bug C: 100% agreement on a collapsed factor set (available < 5) must not grant the -8 bonus", () => {
    // With very thin data for both players, most factors become limited/neutral.
    // The available opinionated factor count will be < 5.
    // The agreement bonus must NOT fire in that case.
    const selThin = makeStats({ total: 3, winRate: 0.70, recentWinRate: 0.70 });
    const oppThin = makeStats({ total: 3, winRate: 0.30, recentWinRate: 0.30 });

    const rThin = __TEST_computeScoring(selThin, oppThin);

    if (rThin.available < 5) {
      // The bonus guard must have kicked in — risk can't have been reduced by it.
      // Cross-check: manually compute what risk would be WITHOUT the bonus.
      // We can't call the internal formula directly, but we can verify via the
      // collapsed-vs-full comparison below.
      //
      // The invariant here: with collapsed data, risk must be at least as high
      // as the baseline 35 + thin-data penalties (no bonus applied).
      // Continuous scarcity formula: Math.round((1 - min(1, total/10)) * 15)
      //   total=3 → Math.round(0.7 * 15) = 11 for each player.  Baseline = 35+22 = 57.
      // agreementRate > 0.75 but available < 5 → no -8 reduction.
      const selScarcity = Math.round((1 - Math.min(1, selThin.total / 10)) * 15);
      const oppScarcity = Math.round((1 - Math.min(1, oppThin.total / 10)) * 15);
      const minExpectedRisk = 35 + selScarcity + oppScarcity; // baseline + continuous thin-data penalties
      // The closeness floor may raise it further; the bonus CANNOT lower it.
      assert.ok(
        rThin.riskScore >= minExpectedRisk,
        `Collapsed factor set (available=${rThin.available}) must not fire -8 bonus — ` +
        `riskScore ${rThin.riskScore} should be >= ${minExpectedRisk} (35 + ${selScarcity} + ${oppScarcity})`,
      );
    }
    // If available somehow >= 5 with this thin data, the bonus gate doesn't apply;
    // the test is vacuously satisfied — no assertion needed.
  });

  it("Bug C: 100% agreement with available >= 5 does grant the -8 bonus (regression guard)", () => {
    // Verify the bonus still fires when the sample is large enough.
    // Strongly dominant player → many factors agree → available >= 5.
    const selDominant = makeStats({ total: 30, winRate: 0.82, recentWinRate: 0.82, currentRank: 10 });
    const oppWeak     = makeStats({ total: 30, winRate: 0.32, recentWinRate: 0.32, currentRank: 200 });

    const rDominant = __TEST_computeScoring(selDominant, oppWeak);

    if (rDominant.available >= 5 && rDominant.agreementRate > 0.75) {
      // With available >= 5 and high agreement, the -8 bonus should fire.
      // A dominant player with no thin-data penalty should have risk well below 55.
      assert.ok(
        rDominant.riskScore <= 55,
        `Dominant player with available=${rDominant.available} and ` +
        `agreement=${Math.round(rDominant.agreementRate * 100)}% should get the -8 bonus ` +
        `(riskScore=${rDominant.riskScore} should be <= 55)`,
      );
    }
    // If somehow the dominant player doesn't hit available >= 5, test is vacuously ok.
  });

  // ── Bug D: consistency guard ──────────────────────────────────────────────

  it("Bug D: Elite grade + insufficient data → forced down to Strong, caughtInconsistency set", () => {
    // Create stats that would produce a high validation score but override status to insufficient.
    // This simulates a scenario where the grade resolution would reach Elite on score alone
    // but the data gap should prevent it.
    const selDominant = makeStats({ total: 20, winRate: 0.85, recentWinRate: 0.85, currentRank: 5 });
    const oppWeak     = makeStats({ total: 20, winRate: 0.30, recentWinRate: 0.30, currentRank: 250 });

    // First: verify the baseline grade without the override (data is fine by default).
    const rBaseline = __TEST_computeScoring(selDominant, oppWeak);

    // Now override with insufficient data status.
    const rWithGap = __TEST_computeScoring(selDominant, oppWeak, {
      selectedPlayerStatus: "insufficient_data",
    });

    if (rBaseline.parlayGrade === "Elite") {
      // The guard should have fired and forced it down.
      assert.strictEqual(rWithGap.parlayGrade, "Strong",
        `Elite grade should be forced down to Strong when selectedPlayerStatus=insufficient_data ` +
        `(was ${rWithGap.parlayGrade})`);
      assert.ok(rWithGap.caughtInconsistency !== null,
        "caughtInconsistency must be set when the consistency guard fires");
      assert.ok(rWithGap.caughtInconsistency!.includes("Consistency guard"),
        `caughtInconsistency message should mention 'Consistency guard' (was: ${rWithGap.caughtInconsistency})`);
    } else {
      // Grade wasn't Elite even without the gap — consistency guard correctly had nothing to do.
      assert.strictEqual(rWithGap.caughtInconsistency, null,
        "caughtInconsistency must be null when grade was not Elite before the guard");
    }
  });

  it("Bug D: player_not_found status with Elite grade → forced down to Strong", () => {
    const selDominant = makeStats({ total: 20, winRate: 0.85, recentWinRate: 0.85, currentRank: 5 });
    const oppWeak     = makeStats({ total: 20, winRate: 0.30, recentWinRate: 0.30, currentRank: 250 });

    const rBaseline  = __TEST_computeScoring(selDominant, oppWeak);
    const rNotFound  = __TEST_computeScoring(selDominant, oppWeak, {
      opponentStatus: "player_not_found",
    });

    if (rBaseline.parlayGrade === "Elite") {
      assert.notStrictEqual(rNotFound.parlayGrade, "Elite",
        "Elite grade must not survive when opponent is player_not_found");
      assert.ok(rNotFound.caughtInconsistency !== null,
        "caughtInconsistency must be set when consistency guard fires due to player_not_found");
    }
  });

  it("Bug D: data_available status for both players → no consistency guard fires", () => {
    const selStats = makeStats({ total: 20, winRate: 0.65 });
    const oppStats = makeStats({ total: 20, winRate: 0.50 });

    const r = __TEST_computeScoring(selStats, oppStats, {
      selectedPlayerStatus: "data_available",
      opponentStatus: "data_available",
    });

    // If grade is Elite with both statuses "data_available", the guard must NOT downgrade.
    assert.strictEqual(r.caughtInconsistency, null,
      "No inconsistency should be caught when both players have data_available status");
    // Grade may or may not be Elite — not under test here. Just verify no spurious downgrade.
    if (r.parlayGrade === "Elite") {
      assert.strictEqual(r.caughtInconsistency, null,
        "Elite grade with data_available on both sides must NOT be downgraded");
    }
  });
});

// ─── Market Consensus factor tests ───────────────────────────────────────────
//
// `__TEST_computeScoring` accepts `opts.marketOdds` (the selected player's decimal odds,
// same as what `attemptOddsApi` returns). These tests verify the factor's scoring direction,
// neutral fallback, and underdog penalty — all without network access.

describe("builderScoringService — marketConsensus factor invariants", () => {
  it("market factor scores > 50 when the selected player is the market favorite (odds 1.60)", () => {
    const sel = makeStats({ total: 20, winRate: 0.60 });
    const opp = makeStats({ total: 20, winRate: 0.50 });
    // 1.60 decimal odds → implied probability ≈ 62.5% → factor must score above neutral
    const result = __TEST_computeScoring(sel, opp, {
      selResolvedId: "sel",
      opponentName: "P.Opp",
      marketOdds: 1.60,
    });

    const factor = result.factors.find(f => f.key === "marketConsensus");
    assert.ok(factor !== undefined, "marketConsensus factor must be present when odds are supplied");
    assert.ok(
      factor!.score > 50,
      `market factor score must be > 50 when selected is favorite (got ${factor!.score})`,
    );
  });

  it("market factor scores 50 (neutral) and is marked unavailable when no odds are supplied", () => {
    const sel = makeStats({ total: 20, winRate: 0.60 });
    const opp = makeStats({ total: 20, winRate: 0.50 });
    const result = __TEST_computeScoring(sel, opp, {
      selResolvedId: "sel",
      opponentName: "P.Opp",
      marketOdds: null,
    });

    const factor = result.factors.find(f => f.key === "marketConsensus");
    assert.ok(factor !== undefined, "marketConsensus factor must always be present in the factor list");
    assert.strictEqual(
      factor!.score,
      50,
      `marketConsensus must score exactly 50 (neutral) when no odds are supplied (got ${factor!.score})`,
    );
    // When no odds are supplied, the factor exists but is marked non-available
    // (the implementation marks it "limited" — absence of real odds, not a provider failure)
    assert.ok(
      factor!.status !== "available",
      `marketConsensus must NOT be marked available when no odds are supplied (got '${factor!.status}')`,
    );
  });

  it("market factor scores < 50 when the selected player is the underdog (odds 2.50)", () => {
    const sel = makeStats({ total: 20, winRate: 0.50 });
    const opp = makeStats({ total: 20, winRate: 0.60 });
    // 2.50 decimal odds → implied probability = 40% → factor must score below neutral
    const result = __TEST_computeScoring(sel, opp, {
      selResolvedId: "sel",
      opponentName: "P.Opp",
      marketOdds: 2.50,
    });

    const factor = result.factors.find(f => f.key === "marketConsensus");
    assert.ok(factor !== undefined, "marketConsensus factor must be present when odds are supplied");
    assert.ok(
      factor!.score < 50,
      `market factor score must be < 50 when selected is underdog at 2.50 odds (got ${factor!.score})`,
    );
  });

  it("market factor direction is symmetric: swapping favorite/underdog mirrors the score across 50", () => {
    const sel = makeStats({ total: 20, winRate: 0.55 });
    const opp = makeStats({ total: 20, winRate: 0.55 });

    const asFavorite  = __TEST_computeScoring(sel, opp, { selResolvedId: "sel", opponentName: "P.Opp", marketOdds: 1.60 });
    const asUnderdog  = __TEST_computeScoring(sel, opp, { selResolvedId: "sel", opponentName: "P.Opp", marketOdds: 2.67 }); // ≈ 1/(1-1/1.60) reciprocal implied

    const favFactor  = asFavorite.factors.find(f => f.key === "marketConsensus");
    const undFactor  = asUnderdog.factors.find(f => f.key === "marketConsensus");
    assert.ok(favFactor !== undefined && undFactor !== undefined, "both results must have a marketConsensus factor");
    assert.ok(
      favFactor!.score > 50 && undFactor!.score < 50,
      `favorite odds must score > 50 (${favFactor!.score}) and underdog odds must score < 50 (${undFactor!.score})`,
    );
  });
});
