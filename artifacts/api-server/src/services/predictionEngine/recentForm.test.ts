import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRecentFormModule } from "./recentForm";
import type { MatchRecord } from "../tennisData/types";

function baseMatch(
  id: string,
  i: number,
  surface: MatchRecord["surface"],
  result: "W" | "L",
  overrides: Partial<Pick<MatchRecord, "date" | "tournamentLevel" | "retired" | "walkover" | "stats">> = {},
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
    retired: overrides.retired ?? false,
    walkover: overrides.walkover ?? false,
    stats: overrides.stats ?? null,
    opponentStats: null,
    setGameMargins: [],
  };
}

function wins(count: number, surface: MatchRecord["surface"] = "Hard", overrides: Partial<MatchRecord> = {}): MatchRecord[] {
  return Array.from({ length: count }, (_, i) => ({ ...baseMatch(`w${i}`, i, surface, "W"), ...overrides }));
}

function losses(count: number, surface: MatchRecord["surface"] = "Hard", overrides: Partial<MatchRecord> = {}): MatchRecord[] {
  return Array.from({ length: count }, (_, i) => ({ ...baseMatch(`l${i}`, i, surface, "L"), ...overrides }));
}

test("form and trend stay stable/neutral defaults with no match history", () => {
  const result = computeRecentFormModule([], [], "Hard");
  assert.equal(result.player1Form, 50);
  assert.equal(result.player2Form, 50);
  assert.equal(result.player1Trend, "stable");
  assert.equal(result.player2Trend, "stable");
});

test("a same-surface win streak scores higher than an identical off-surface win streak, holding losses fixed", () => {
  const lossesOnClay = losses(4, "Clay");
  const onSurface = computeRecentFormModule([...wins(4, "Clay"), ...lossesOnClay], [], "Clay");
  const offSurface = computeRecentFormModule([...wins(4, "Grass"), ...lossesOnClay], [], "Clay");
  assert.ok(
    onSurface.player1Form > offSurface.player1Form,
    `expected on-surface wins (${onSurface.player1Form}) to score higher than off-surface wins of the same shape (${offSurface.player1Form})`,
  );
});

test("a win streak at Grand Slam level scores higher than the same streak at ITF level, holding losses fixed", () => {
  const lossesOnHard = losses(4, "Hard");
  const slamResult = computeRecentFormModule([...wins(4, "Hard", { tournamentLevel: "GrandSlam" }), ...lossesOnHard], [], "Hard");
  const itfResult = computeRecentFormModule([...wins(4, "Hard", { tournamentLevel: "ITF" }), ...lossesOnHard], [], "Hard");
  assert.ok(
    slamResult.player1Form > itfResult.player1Form,
    `expected Grand Slam wins (${slamResult.player1Form}) to score higher than ITF wins of the same shape (${itfResult.player1Form})`,
  );
});

test("a retirement win counts for less than a clean win, holding losses fixed", () => {
  const lossesOnHard = losses(4, "Hard");
  const cleanResult = computeRecentFormModule([...wins(4, "Hard"), ...lossesOnHard], [], "Hard");
  const retiredResult = computeRecentFormModule([...wins(4, "Hard", { retired: true }), ...lossesOnHard], [], "Hard");
  assert.ok(
    cleanResult.player1Form > retiredResult.player1Form,
    `expected clean wins (${cleanResult.player1Form}) to score higher than retirement wins of the same shape (${retiredResult.player1Form})`,
  );
});

test("a strong serve/return stat line lifts the form score above a plain loss with no stats", () => {
  const plainLosses = losses(6, "Hard");
  const competitiveStatsLosses = losses(6, "Hard", {
    stats: { firstServePct: null, firstServeWon: null, secondServeWon: null, aces: null, doubleFaults: null, breakPointsSaved: null, breakPointsFaced: null, returnPointsWon: 50, servicePointsWonPct: 75 },
  });
  const plainResult = computeRecentFormModule(plainLosses, [], "Hard");
  const statsResult = computeRecentFormModule(competitiveStatsLosses, [], "Hard");
  assert.ok(
    statsResult.player1Form > plainResult.player1Form,
    `expected a strong stat line despite losing (${statsResult.player1Form}) to score higher than plain losses with no stats (${plainResult.player1Form})`,
  );
  assert.ok(statsResult.player1ServeReturnCoverage === 100);
  assert.ok(plainResult.player1ServeReturnCoverage === 0);
});

test("a short 2-3 match streak alone cannot flip the trend label off stable", () => {
  // Only 5 total matches -- under TREND_MIN_SAMPLE (6), so the label must stay "stable" no matter
  // how large the shape's delta is.
  const short = [...wins(2, "Hard", { date: "2026-07-01" }), ...losses(3, "Hard", { date: "2025-01-01" })];
  const result = computeRecentFormModule(short, losses(6, "Hard"), "Hard");
  assert.equal(result.player1Trend, "stable");
});

test("a large, sustained shift over enough matches produces a non-stable trend label", () => {
  const improving = [...wins(6, "Hard", { date: "2026-07-01" }), ...losses(6, "Hard", { date: "2024-01-01" })];
  const result = computeRecentFormModule(improving, losses(12, "Hard"), "Hard");
  assert.equal(result.player1Trend, "improving");

  const declining = [...losses(6, "Hard", { date: "2026-07-01" }), ...wins(6, "Hard", { date: "2024-01-01" })];
  const declineResult = computeRecentFormModule(declining, losses(12, "Hard"), "Hard");
  assert.equal(declineResult.player1Trend, "declining");
});
