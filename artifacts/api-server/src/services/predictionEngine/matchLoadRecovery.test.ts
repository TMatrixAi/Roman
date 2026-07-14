import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMatchLoadRecoveryModule } from "./matchLoadRecovery";
import type { MatchRecord } from "../tennisData/types";

function match(date: string, sets: number, matchFormat: "BestOf3" | "BestOf5" | null = "BestOf3"): MatchRecord {
  return {
    id: `m-${date}`,
    date,
    tournamentName: null,
    tournamentLevel: null,
    round: null,
    matchFormat,
    surface: null,
    indoor: null,
    opponentId: "opp",
    opponentName: "Opponent",
    opponentRank: null,
    result: "W",
    score: null,
    retired: false,
    walkover: false,
    stats: null,
    opponentStats: null,
    setGameMargins: Array.from({ length: sets }, () => ({ playerGames: 6, opponentGames: 4 })),
  };
}

test("computeMatchLoadRecoveryModule measures restDays against the provided asOfDate, not the real current time (restDays is informational only)", () => {
  const asOfDate = new Date("2026-06-15T12:00:00.000Z");
  // Player 1 played yesterday (short rest); player 2's only match was over a year ago.
  const p1Matches = [match("2026-06-14", 2)];
  const p2Matches = [match("2025-01-01", 2)];
  const result = computeMatchLoadRecoveryModule(p1Matches, p2Matches, asOfDate);

  assert.equal(result.player1RestDays, 1);
  assert.ok(result.player2RestDays! > 300);
});

test("validated formula: rest days do NOT feed the risk score -- only whether the most recent match went the distance does (Candidate A, rest-days-only, was tested and rejected)", () => {
  const asOfDate = new Date("2026-06-15T12:00:00.000Z");
  // Player 1 has very short rest but a straight-sets (non-distance) last match; player 2 has
  // plenty of rest but their last match went the distance. Despite the huge rest-day gap, the
  // score must be driven entirely by went-the-distance, not rest days.
  const shortRestStraightSets = [match("2026-06-14", 2)]; // 1 day rest, straight sets
  const longRestWentDistance = [match("2026-05-01", 3)]; // 45 days rest, went the distance
  const result = computeMatchLoadRecoveryModule(shortRestStraightSets, longRestWentDistance, asOfDate);

  assert.equal(result.player1RestDays, 1);
  assert.equal(result.player2RestDays, 45);
  assert.equal(result.player1RecoveryRiskScore, 0, "short rest alone must not raise the risk score");
  assert.ok(result.player2RecoveryRiskScore > result.player1RecoveryRiskScore, "went-the-distance must drive risk higher, regardless of the much longer rest");
});

test("computeMatchLoadRecoveryModule with no asOfDate defaults to the real current time (live-path behavior)", () => {
  const now = new Date();
  const veryRecent: MatchRecord[] = [match(now.toISOString(), 2)];
  const resultWithDefault = computeMatchLoadRecoveryModule(veryRecent, [], undefined);
  const resultWithExplicitNow = computeMatchLoadRecoveryModule(veryRecent, [], now);
  assert.equal(resultWithDefault.player1RestDays, resultWithExplicitNow.player1RestDays);
  assert.equal(resultWithDefault.player1RecoveryRiskScore, resultWithExplicitNow.player1RecoveryRiskScore);
});

test("a historical match close in real wall-clock terms but far from its own historical asOfDate is measured against asOfDate, not today", () => {
  const historicalAsOfDate = new Date("2024-03-15T00:00:00.000Z");
  const matches: MatchRecord[] = [match("2024-02-24", 2)]; // 20 days before asOfDate
  const result = computeMatchLoadRecoveryModule(matches, [], historicalAsOfDate);
  assert.equal(result.player1RestDays, 20);
  assert.equal(result.player1RecoveryRiskScore, 0); // well-rested, no short-turnaround penalty
});

test("going the distance in the most recent match raises the risk score, independent of rest days", () => {
  const asOfDate = new Date("2026-06-15T12:00:00.000Z");
  const wentDistance = [match("2026-06-14", 3)]; // 3-set BestOf3 (went the distance)
  const straightSets = [match("2026-06-14", 2)]; // same rest, straight sets
  const withDistance = computeMatchLoadRecoveryModule(wentDistance, [], asOfDate);
  const withoutDistance = computeMatchLoadRecoveryModule(straightSets, [], asOfDate);
  assert.equal(withDistance.player1RecentMatchWentDistance, true);
  assert.equal(withoutDistance.player1RecentMatchWentDistance, false);
  assert.ok(withDistance.player1RecoveryRiskScore > withoutDistance.player1RecoveryRiskScore);
});

test("BestOf5 requires 4+ sets to count as went-the-distance, not 3", () => {
  const asOfDate = new Date("2026-06-15T12:00:00.000Z");
  const threeSetBo5 = [match("2026-06-14", 3, "BestOf5")];
  const fourSetBo5 = [match("2026-06-14", 4, "BestOf5")];
  const resultThree = computeMatchLoadRecoveryModule(threeSetBo5, [], asOfDate);
  const resultFour = computeMatchLoadRecoveryModule(fourSetBo5, [], asOfDate);
  assert.equal(resultThree.player1RecentMatchWentDistance, false);
  assert.equal(resultFour.player1RecentMatchWentDistance, true);
});

test("real data quirk: setGameMargins is a fixed-length array padded with {0,0} trailing entries for unplayed sets -- these must not count as real sets played", () => {
  const asOfDate = new Date("2026-06-15T12:00:00.000Z");
  // A real straight-sets (2-set) BestOf3 win, stored the way the historical store actually pads it.
  const paddedStraightSets: MatchRecord = {
    ...match("2026-06-14", 0),
    setGameMargins: [
      { playerGames: 6, opponentGames: 4 },
      { playerGames: 6, opponentGames: 3 },
      { playerGames: 0, opponentGames: 0 },
      { playerGames: 0, opponentGames: 0 },
      { playerGames: 0, opponentGames: 0 },
    ],
  };
  const result = computeMatchLoadRecoveryModule([paddedStraightSets], [], asOfDate);
  // 2 real sets played -- must NOT be misread as "went the distance" just because the raw array has length 5.
  assert.equal(result.player1RecentMatchWentDistance, false);
});

test("a player with no prior match at all gets an unknown (0) recovery risk, not a fabricated fresh/tired guess", () => {
  const asOfDate = new Date("2026-06-15T12:00:00.000Z");
  const result = computeMatchLoadRecoveryModule([], [], asOfDate);
  assert.equal(result.player1RestDays, null);
  assert.equal(result.player2RestDays, null);
  assert.equal(result.player1RecoveryRiskScore, 0);
  assert.equal(result.player2RecoveryRiskScore, 0);
  assert.ok(result.warnings.length > 0);
});
