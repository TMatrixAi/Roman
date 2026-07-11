import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAvailabilityModule } from "./availability";
import type { MatchRecord } from "../tennisData/types";

function match(overrides: Partial<MatchRecord>): MatchRecord {
  return {
    id: "1",
    date: "2026-07-01",
    tournamentName: "Wimbledon",
    tournamentLevel: "GrandSlam",
    round: "R1",
    matchFormat: "BestOf5",
    surface: "Grass",
    indoor: false,
    opponentId: "999",
    opponentName: "Opponent",
    opponentRank: null,
    result: "W",
    score: "6-4 6-4",
    retired: false,
    walkover: false,
    stats: null,
    opponentStats: null,
    setGameMargins: [],
    ...overrides,
  };
}

test("computes real rest days and travel distance when both venues resolve", () => {
  const now = new Date("2026-07-11T00:00:00Z");
  const p1 = [match({ date: "2026-07-05T00:00:00Z", tournamentName: "Wimbledon" })];
  const p2 = [match({ date: "2026-07-08T00:00:00Z", tournamentName: "Roland Garros" })];

  const result = computeAvailabilityModule(p1, p2, "US Open", now);

  assert.equal(result.player1.daysSinceLastMatch, 6);
  assert.equal(result.player2.daysSinceLastMatch, 3);
  assert.ok(result.player1.travelDistanceKm !== null && result.player1.travelDistanceKm > 5000);
  assert.ok(result.player2.travelDistanceKm !== null && result.player2.travelDistanceKm > 5000);
  assert.equal(result.reliability, 100);
});

test("reports travel as unavailable (never guessed) when a venue can't be resolved", () => {
  const now = new Date("2026-07-11T12:00:00Z");
  const p1 = [match({ date: "2026-07-05", tournamentName: "Obscure Challenger Event" })];
  const p2 = [match({ date: "2026-07-08", tournamentName: "Roland Garros" })];

  const result = computeAvailabilityModule(p1, p2, "US Open", now);

  assert.equal(result.player1.travelDistanceKm, null);
  assert.ok(result.warnings.some((w) => w.includes("travel distance unavailable")));
  assert.ok(result.reliability < 100);
});

test("flags a real recent retirement only for the player who actually retired, within the window", () => {
  const now = new Date("2026-07-11T12:00:00Z");
  const p1 = [match({ date: "2026-07-05", tournamentName: "Wimbledon", retired: true, result: "L" })];
  // Opponent side of a retirement (won via opponent's retirement) must NOT be flagged.
  const p2 = [match({ date: "2026-07-08", tournamentName: "Wimbledon", retired: true, result: "W" })];

  const result = computeAvailabilityModule(p1, p2, "US Open", now);

  assert.equal(result.player1.recentRetirementOrWithdrawal, true);
  assert.equal(result.player1.recentRetirementTournament, "Wimbledon");
  assert.equal(result.player2.recentRetirementOrWithdrawal, false);
});

test("does not flag a retirement outside the recency window, and reports nulls (not zeros) with no match history", () => {
  const now = new Date("2026-07-11T12:00:00Z");
  const p1 = [match({ date: "2026-05-01", tournamentName: "Wimbledon", retired: true, result: "L" })];
  const p2: MatchRecord[] = [];

  const result = computeAvailabilityModule(p1, p2, "US Open", now);

  assert.equal(result.player1.recentRetirementOrWithdrawal, false);
  assert.equal(result.player2.daysSinceLastMatch, null);
  assert.equal(result.player2.travelDistanceKm, null);
  assert.ok(result.warnings.some((w) => w.includes("no prior match history")));
});
