import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSurfaceEloModule } from "./surfaceElo";
import type { MatchRecord } from "../tennisData/types";

function baseMatch(id: string, i: number, surface: MatchRecord["surface"], result: "W" | "L"): MatchRecord {
  return {
    id,
    date: `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
    tournamentName: null,
    tournamentLevel: null,
    round: null,
    matchFormat: null,
    surface,
    indoor: null,
    opponentId: `opp${i}`,
    opponentName: `Opponent ${i}`,
    opponentRank: null,
    result,
    score: null,
    retired: false,
    walkover: false,
    stats: null,
    opponentStats: null,
    setGameMargins: [],
  };
}

function wins(count: number, surface: MatchRecord["surface"] = "Hard"): MatchRecord[] {
  return Array.from({ length: count }, (_, i) => baseMatch(`w${i}`, i, surface, "W"));
}

function losses(count: number, surface: MatchRecord["surface"] = "Hard"): MatchRecord[] {
  return Array.from({ length: count }, (_, i) => baseMatch(`l${i}`, i, surface, "L"));
}

test("eloWinProbabilityPlayer1 stays within [0, 100] for a roughly even matchup", () => {
  const result = computeSurfaceEloModule(wins(10), wins(10), "Hard");
  assert.ok(result.eloWinProbabilityPlayer1 >= 0 && result.eloWinProbabilityPlayer1 <= 100);
  assert.ok(Math.abs(result.eloWinProbabilityPlayer1 - 50) < 5);
});

test("eloWinProbabilityPlayer1 never exceeds 100 or drops below 0, even for a very large rating gap", () => {
  // One player with a long, dominant win streak vs. one with a long losing streak produces the
  // largest realistic Elo gap this module can generate.
  const dominant = computeSurfaceEloModule(wins(200), losses(200), "Hard");
  assert.ok(dominant.eloWinProbabilityPlayer1 <= 100, `expected <= 100, got ${dominant.eloWinProbabilityPlayer1}`);
  assert.ok(dominant.eloWinProbabilityPlayer1 >= 0, `expected >= 0, got ${dominant.eloWinProbabilityPlayer1}`);
  assert.ok(dominant.eloWinProbabilityPlayer1 > 90, "expected the heavily favored player to show a very high, but still <= 100, probability");

  const underdog = computeSurfaceEloModule(losses(200), wins(200), "Hard");
  assert.ok(underdog.eloWinProbabilityPlayer1 <= 100, `expected <= 100, got ${underdog.eloWinProbabilityPlayer1}`);
  assert.ok(underdog.eloWinProbabilityPlayer1 >= 0, `expected >= 0, got ${underdog.eloWinProbabilityPlayer1}`);
  assert.ok(underdog.eloWinProbabilityPlayer1 < 10, "expected the heavily disfavored player to show a very low, but still >= 0, probability");
});
