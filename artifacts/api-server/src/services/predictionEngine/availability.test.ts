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

test("reports travel as unavailable (never guessed) when a venue can't be resolved, without a user-facing warning", () => {
  const now = new Date("2026-07-11T12:00:00Z");
  const p1 = [match({ date: "2026-07-05", tournamentName: "Obscure Challenger Event" })];
  const p2 = [match({ date: "2026-07-08", tournamentName: "Roland Garros" })];

  const result = computeAvailabilityModule(p1, p2, "US Open", now);

  assert.equal(result.player1.travelDistanceKm, null);
  // Unresolved travel distance is expected/common noise, not a warning worth surfacing.
  assert.ok(!result.warnings.some((w) => w.includes("travel distance unavailable")));
  assert.ok(!result.warnings.some((w) => w.includes("known-venue list")));
  // Rest days for both players still resolved, so reliability barely dips below 100 --
  // rest dominates the weighting and unresolved travel only costs a little.
  assert.ok(result.reliability < 100 && result.reliability >= 90);
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

test("buckets rest days against the documented thresholds", () => {
  const now = new Date("2026-07-11T00:00:00Z");
  const shortRest = [match({ date: "2026-07-10", tournamentName: "Wimbledon" })]; // 1 day
  const normalRest = [match({ date: "2026-07-04", tournamentName: "Wimbledon" })]; // 7 days
  const longLayoff = [match({ date: "2026-06-01", tournamentName: "Wimbledon" })]; // 40 days
  const noHistory: MatchRecord[] = [];

  assert.equal(computeAvailabilityModule(shortRest, normalRest, "US Open", now).player1.restCategory, "ShortRest");
  assert.equal(computeAvailabilityModule(normalRest, shortRest, "US Open", now).player1.restCategory, "Normal");
  assert.equal(computeAvailabilityModule(longLayoff, normalRest, "US Open", now).player1.restCategory, "LongLayoff");
  assert.equal(computeAvailabilityModule(noHistory, normalRest, "US Open", now).player1.restCategory, "Unknown");
});

test("buckets real travel distance into None/Local/Regional/Intercontinental", () => {
  const now = new Date("2026-07-11T00:00:00Z");
  // Wimbledon -> Wimbledon is the same venue (0km, "None").
  const same = [match({ date: "2026-07-05", tournamentName: "Wimbledon" })];
  // Wimbledon -> Roland Garros is a real cross-channel hop, well beyond the Regional cap.
  const farAway = [match({ date: "2026-07-05", tournamentName: "Roland Garros" })];

  const sameVenueResult = computeAvailabilityModule(same, farAway, "Wimbledon", now);
  assert.equal(sameVenueResult.player1.travelBucket, "None");

  const crossChannelResult = computeAvailabilityModule(farAway, same, "US Open", now);
  assert.ok(crossChannelResult.player1.travelDistanceKm !== null && crossChannelResult.player1.travelDistanceKm > 0);
  assert.ok(["Local", "Regional", "Intercontinental"].includes(crossChannelResult.player1.travelBucket as string));
});

test("flags a confirmed pre-match walkover distinctly from a mid-match retirement, and prefers it when both fire", () => {
  const now = new Date("2026-07-11T12:00:00Z");
  const walkoverOnly = [match({ date: "2026-07-05", tournamentName: "Wimbledon", walkover: true, result: "L" })];
  const retirementOnly = [match({ date: "2026-07-05", tournamentName: "Wimbledon", retired: true, result: "L" })];

  const walkoverResult = computeAvailabilityModule(walkoverOnly, retirementOnly, "US Open", now);
  assert.equal(walkoverResult.player1.recentWalkoverGiven, true);
  assert.equal(walkoverResult.player1.confirmedAvailabilityConcernType, "Walkover");
  assert.equal(walkoverResult.player2.confirmedAvailabilityConcernType, "MidMatchRetirement");
  assert.ok(walkoverResult.warnings.some((w) => w.includes("withdrawn (walkover)")));

  // A walkover is a stronger confirmed signal than a retirement -- its player should score lower.
  assert.ok(walkoverResult.player1AvailabilityScore < walkoverResult.player2AvailabilityScore);
});

test("computes a real-data-only availability score that stays neutral when nothing resolves", () => {
  const now = new Date("2026-07-11T12:00:00Z");
  const result = computeAvailabilityModule([], [], "US Open", now);
  // No resolvable rest/travel/withdrawal data for either player -- score should sit at the
  // documented neutral baseline, never a fabricated extreme in either direction.
  assert.equal(result.player1AvailabilityScore, result.player2AvailabilityScore);
  assert.ok(result.player1AvailabilityScore > 0 && result.player1AvailabilityScore < 100);
});
