import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveMonteCarloHeadline } from "./monteCarloHeadline";

const BASE = {
  player1Id: "p1",
  player1Name: "Player One",
  player2Name: "Player Two",
  player1WinProbability: 72,
  rangeLow: 60,
  rangeHigh: 84,
};

test("when player1 is the predicted winner, the headline shows player1's own stored figures unmirrored", () => {
  const result = deriveMonteCarloHeadline({ ...BASE, predictedWinnerId: "p1" });
  assert.equal(result.winnerIsPlayer1, true);
  assert.equal(result.headlineWinnerName, "Player One");
  assert.equal(result.headlineWinProbability, 72);
  assert.equal(result.headlineRangeLow, 60);
  assert.equal(result.headlineRangeHigh, 84);
});

test("regression: when player2 is the predicted winner, the headline must show player2's MIRRORED figures, not player1's raw numbers", () => {
  // This is the exact bug that shipped: the headline used to always render
  // player1WinProbability/rangeLow/rangeHigh verbatim, so a player2 winner's headline silently
  // showed the LOSER's (player1's) win probability instead of their own.
  const result = deriveMonteCarloHeadline({ ...BASE, predictedWinnerId: "p2" });
  assert.equal(result.winnerIsPlayer1, false);
  assert.equal(result.headlineWinnerName, "Player Two");
  assert.equal(result.headlineWinProbability, 28, "must be 100 - player1WinProbability, never player1WinProbability itself");
  assert.notEqual(result.headlineWinProbability, BASE.player1WinProbability, "headline must never silently show the loser's win probability");
  assert.equal(result.headlineRangeLow, 16, "mirrored low bound is 100 - the stored high bound");
  assert.equal(result.headlineRangeHigh, 40, "mirrored high bound is 100 - the stored low bound");
});

test("range bounds stay ordered (low <= high) after mirroring, for both winner directions", () => {
  for (const predictedWinnerId of ["p1", "p2"]) {
    const result = deriveMonteCarloHeadline({ ...BASE, predictedWinnerId });
    assert.ok(result.headlineRangeLow <= result.headlineRangeHigh, `range must stay ordered for predictedWinnerId=${predictedWinnerId}`);
  }
});

test("an exact 50/50 toss-up (player1WinProbability=50) mirrors to an identical headline regardless of who is named the winner", () => {
  const p1Winner = deriveMonteCarloHeadline({ ...BASE, player1WinProbability: 50, rangeLow: 45, rangeHigh: 55, predictedWinnerId: "p1" });
  const p2Winner = deriveMonteCarloHeadline({ ...BASE, player1WinProbability: 50, rangeLow: 45, rangeHigh: 55, predictedWinnerId: "p2" });
  assert.equal(p1Winner.headlineWinProbability, 50);
  assert.equal(p2Winner.headlineWinProbability, 50);
  assert.equal(p1Winner.headlineRangeLow, 45);
  assert.equal(p2Winner.headlineRangeLow, 45);
});
