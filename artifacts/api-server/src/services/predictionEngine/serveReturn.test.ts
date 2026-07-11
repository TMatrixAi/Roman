// Unit tests for the serve/return module's real-stats vs. margin-proxy fallback behavior.
// Run with: tsx --test src/services/predictionEngine/serveReturn.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { computeServeReturnModule } from "./serveReturn";
import type { MatchRecord, MatchStatLine } from "../tennisData/types";

function statLine(overrides: Partial<MatchStatLine>): MatchStatLine {
  return {
    firstServePct: null,
    firstServeWon: null,
    secondServeWon: null,
    aces: null,
    doubleFaults: null,
    breakPointsSaved: null,
    breakPointsFaced: null,
    returnPointsWon: null,
    servicePointsWonPct: null,
    ...overrides,
  };
}

function baseMatch(overrides: Partial<MatchRecord>): MatchRecord {
  return {
    id: "m1",
    date: "2026-01-01",
    tournamentName: "Test Open",
    tournamentLevel: "ATP250",
    round: "R32",
    matchFormat: "BestOf3",
    surface: "Hard",
    indoor: null,
    opponentId: "opp",
    opponentName: "Opponent",
    opponentRank: null,
    result: "W",
    score: "6-4 6-4",
    retired: false,
    walkover: false,
    stats: null,
    opponentStats: null,
    setGameMargins: [
      { playerGames: 6, opponentGames: 4 },
      { playerGames: 6, opponentGames: 4 },
    ],
    ...overrides,
  };
}

test("falls back to the margin proxy (capped at 60) when no match has real stats", () => {
  const matches: MatchRecord[] = Array.from({ length: 6 }, (_, i) => baseMatch({ id: `m${i}` }));
  const result = computeServeReturnModule(matches, matches);
  assert.ok(result.reliability <= 60, `expected proxy cap <= 60, got ${result.reliability}`);
  assert.match(result.note ?? "", /does not expose point-level/);
});

test("uses real point-level stats and allows reliability above the proxy's 60 cap when both players have enough", () => {
  const withRealStats: MatchRecord[] = Array.from({ length: 6 }, (_, i) =>
    baseMatch({
      id: `real${i}`,
      stats: statLine({ servicePointsWonPct: 68, returnPointsWon: 42 }),
    }),
  );
  const result = computeServeReturnModule(withRealStats, withRealStats);
  assert.ok(result.reliability > 60, `expected reliability > 60 with real stats, got ${result.reliability}`);
  assert.match(result.note ?? "", /real match-level point statistics/);
  // Both players have identical stats, so ratings should be roughly symmetric around 50.
  assert.ok(result.player1ServeRating > 50, "a service-points-won% above tour average should rate above 50");
  assert.ok(result.player1ReturnRating > 50, "a return-points-won% above tour average should rate above 50");
});

test("falls back to the proxy when only one player has enough matches with real stats", () => {
  const withRealStats: MatchRecord[] = Array.from({ length: 6 }, (_, i) =>
    baseMatch({ id: `real${i}`, stats: statLine({ servicePointsWonPct: 68, returnPointsWon: 42 }) }),
  );
  const proxyOnly: MatchRecord[] = Array.from({ length: 6 }, (_, i) => baseMatch({ id: `proxy${i}` }));
  const result = computeServeReturnModule(withRealStats, proxyOnly);
  assert.match(result.note ?? "", /does not expose point-level/);
  assert.ok(result.reliability <= 60);
});

test("does not regress a proxy-only prediction: identical inputs and outputs to the pre-existing margin logic", () => {
  const matches: MatchRecord[] = Array.from({ length: 3 }, (_, i) => baseMatch({ id: `m${i}` }));
  const result = computeServeReturnModule(matches, matches, new Map(), new Map());
  // 3 matches * 6 = 18 reliability. Both players have identical 6-4 6-4 wins (avg margin +2/set),
  // so ratings should be identical and symmetric, per the pre-existing margin-proxy formula
  // (50 + avgMargin * 6 = 50 + 2*6 = 62).
  assert.equal(result.reliability, 18);
  assert.equal(result.player1ServeRating, 62);
  assert.equal(result.player1ReturnRating, 62);
  assert.equal(result.player1ServeRating, result.player2ServeRating);
  assert.ok(result.warnings.some((w) => /Only 3 match\(es\) with recorded set scores/.test(w)));
  assert.ok(result.warnings.some((w) => /Opponent-strength weighting is only partially available/.test(w)));
});
