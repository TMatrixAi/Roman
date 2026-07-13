import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSurfaceEloModule } from "./surfaceElo";
import type { MatchRecord } from "../tennisData/types";

function baseMatch(
  id: string,
  i: number,
  surface: MatchRecord["surface"],
  result: "W" | "L",
  overrides: Partial<Pick<MatchRecord, "date" | "tournamentLevel">> = {},
): MatchRecord {
  return {
    id,
    date: overrides.date ?? `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
    tournamentName: null,
    tournamentLevel: overrides.tournamentLevel ?? null,
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

test("a player with a thin surface sample blends toward their overall (cross-surface) Elo instead of relying on the surface-only rating alone", () => {
  // Player 1 has a long, dominant record OVERALL, but only 2 matches on Clay specifically (one win, one loss --
  // roughly neutral on Clay alone). Player 2 has no data at all. The overall-Elo fallback should pull
  // player 1's effective Clay rating up well above a neutral/starting value, and the blend weight should be high.
  const thinClaySample: MatchRecord[] = [...wins(30, "Hard"), ...wins(1, "Clay"), ...losses(1, "Clay")];
  const result = computeSurfaceEloModule(thinClaySample, [], "Clay");

  assert.ok(result.player1BlendWeight > 0.3, `expected a high blend weight for a thin 2-match Clay sample, got ${result.player1BlendWeight}`);
  assert.ok(result.player1OverallElo > 1550, `expected a strong overall Elo from the 30-match Hard win streak, got ${result.player1OverallElo}`);
  assert.ok(
    result.player1SurfaceElo > result.player1SurfaceOnlyElo,
    `expected the blended rating (${result.player1SurfaceElo}) to sit above the thin surface-only rating (${result.player1SurfaceOnlyElo})`,
  );
  assert.ok(result.effectiveSampleSizePlayer1 < result.sampleSizePlayer1 + 1, "effective sample size should not exceed the raw match count");
});

test("the blend weight fades toward zero once a player has a deep surface-specific sample", () => {
  const deepClaySample = wins(40, "Clay");
  const result = computeSurfaceEloModule(deepClaySample, [], "Clay");
  assert.ok(result.player1BlendWeight < 0.1, `expected a near-zero blend weight for a 40-match Clay sample, got ${result.player1BlendWeight}`);
});

test("a recent high-level win moves the rating more than an old low-level win of the same shape", () => {
  const recentSlamWin: MatchRecord[] = [baseMatch("m1", 0, "Hard", "W", { date: "2026-07-01", tournamentLevel: "GrandSlam" })];
  const oldItfWin: MatchRecord[] = [baseMatch("m1", 0, "Hard", "W", { date: "2022-01-01", tournamentLevel: "ITF" })];

  const recentResult = computeSurfaceEloModule(recentSlamWin, [], "Hard");
  const oldResult = computeSurfaceEloModule(oldItfWin, [], "Hard");

  assert.ok(
    recentResult.player1SurfaceOnlyElo > oldResult.player1SurfaceOnlyElo,
    `expected a recent Grand Slam win (${recentResult.player1SurfaceOnlyElo}) to move the surface-only rating more than an old ITF win (${oldResult.player1SurfaceOnlyElo})`,
  );
});

test("reliability (confidence) grows with effective sample size and shrinks the win probability toward 50 when thin", () => {
  const thin = computeSurfaceEloModule(wins(2, "Clay"), losses(2, "Clay"), "Clay");
  const deep = computeSurfaceEloModule(wins(30, "Clay"), losses(30, "Clay"), "Clay");

  assert.ok(thin.reliability < deep.reliability, `expected thin-sample reliability (${thin.reliability}) < deep-sample reliability (${deep.reliability})`);

  // Same-shaped, more decisive matchup with a genuinely thin sample should stay closer to 50 than the
  // deep-sample equivalent, and never exceed its own raw (un-shrunk) probability's distance from 50.
  const lopsidedThin = computeSurfaceEloModule(wins(2, "Clay"), losses(2, "Clay"), "Clay");
  assert.ok(
    Math.abs(lopsidedThin.eloWinProbabilityPlayer1 - 50) <= Math.abs(lopsidedThin.rawEloWinProbabilityPlayer1 - 50) + 0.1,
    "the confidence-shrunk probability should never be pulled further from 50 than the raw probability",
  );
});
