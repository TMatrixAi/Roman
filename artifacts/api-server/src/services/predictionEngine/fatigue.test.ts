import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFatigueModule } from "./fatigue";
import type { MatchRecord } from "../tennisData/types";

function match(date: string): MatchRecord {
  return {
    id: `m-${date}`,
    date,
    tournamentName: null,
    tournamentLevel: null,
    round: null,
    matchFormat: null,
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
    setGameMargins: [],
  };
}

// Player 1 played 3 matches within the last 3 days of 2026-06-15 (asOfDate); player 2 has no
// recent matches at all. If Fatigue is measured against Date.now() instead of asOfDate, none of
// player 1's matches (all from mid-2026) would fall inside any window when "today" is 2026-07-14
// (this test's real wall-clock date), and both players would silently tie at 0.
const player1RecentMatches: MatchRecord[] = [match("2026-06-13"), match("2026-06-14"), match("2026-06-15")];
const player2NoRecentMatches: MatchRecord[] = [match("2025-01-01")];
const asOfDate = new Date("2026-06-15T12:00:00.000Z");

test("computeFatigueModule measures recency against the provided asOfDate, not the real current time", () => {
  const result = computeFatigueModule(player1RecentMatches, player2NoRecentMatches, asOfDate);

  assert.equal(result.player1MatchesLast3Days, 3);
  assert.equal(result.player1MatchesLast7Days, 3);
  assert.equal(result.player1MatchesLast14Days, 3);
  assert.equal(result.player2MatchesLast3Days, 0);
  assert.equal(result.player2MatchesLast7Days, 0);
  assert.equal(result.player2MatchesLast14Days, 0);
  // Player 1's real match load should score meaningfully higher than player 2's zero load --
  // this is the exact signal that was silently flattened to 0/0 (a 50/50 tie) when the module
  // compared 2026 match dates against Date.now() during backtest evaluation.
  assert.ok(result.player1FatigueScore > result.player2FatigueScore, `expected player1 (${result.player1FatigueScore}) > player2 (${result.player2FatigueScore})`);
});

test("computeFatigueModule with no asOfDate defaults to the real current time (live-path behavior, unchanged)", () => {
  const now = new Date();
  const veryRecent: MatchRecord[] = [match(now.toISOString().slice(0, 10))];
  const resultWithDefault = computeFatigueModule(veryRecent, [], undefined);
  const resultWithExplicitNow = computeFatigueModule(veryRecent, [], now);

  assert.equal(resultWithDefault.player1MatchesLast3Days, resultWithExplicitNow.player1MatchesLast3Days);
  assert.equal(resultWithDefault.player1FatigueScore, resultWithExplicitNow.player1FatigueScore);
  assert.ok(resultWithDefault.player1MatchesLast3Days >= 1);
});

test("computeFatigueModule: a historical match recent in real wall-clock time terms, but 20+ days before its own historical asOfDate, is correctly measured against asOfDate rather than today", () => {
  // This match's date is only ~1 year before the real "now" this test happens to run on -- if the
  // module measured recency against Date.now() instead of the supplied historical asOfDate, this
  // would still show as "long past" either way, which wouldn't distinguish the two. The real
  // regression case is `historicalScoring.ts`'s actual bug: matches genuinely close in time to
  // their OWN historical asOfDate (see the first test above) were being compared against today's
  // wall-clock date instead and always missed every window. This test locks in the complementary
  // half of that contract: a match that is far (20 days) from asOfDate correctly stays excluded,
  // confirming the window boundary itself still works once asOfDate is threaded through.
  const historicalAsOfDate = new Date("2024-03-15T00:00:00.000Z");
  const matches: MatchRecord[] = [match("2024-02-24")]; // 20 days before asOfDate
  const result = computeFatigueModule(matches, [], historicalAsOfDate);
  assert.equal(result.player1MatchesLast14Days, 0);
  assert.equal(result.player1FatigueScore, 0);
});

test("computeFatigueModule: a match dated 2 days before a historical asOfDate falls inside the 3/7/14-day windows", () => {
  const historicalAsOfDate = new Date("2024-03-15T00:00:00.000Z");
  const matches: MatchRecord[] = [match("2024-03-13")]; // 2 days before asOfDate
  const result = computeFatigueModule(matches, [], historicalAsOfDate);
  assert.equal(result.player1MatchesLast3Days, 1);
  assert.equal(result.player1MatchesLast7Days, 1);
  assert.equal(result.player1MatchesLast14Days, 1);
  assert.ok(result.player1FatigueScore > 0);
});

test("real data quirk: padded {0,0} trailing setGameMargins entries must not count as real set data or inflate estimated games", () => {
  const historicalAsOfDate = new Date("2026-06-15T12:00:00.000Z");
  const paddedMatch: MatchRecord = {
    ...match("2026-06-14"),
    setGameMargins: [
      { playerGames: 6, opponentGames: 4 },
      { playerGames: 6, opponentGames: 4 },
      { playerGames: 0, opponentGames: 0 },
      { playerGames: 0, opponentGames: 0 },
      { playerGames: 0, opponentGames: 0 },
    ],
  };
  const trimmedMatch: MatchRecord = {
    ...match("2026-06-14"),
    setGameMargins: [
      { playerGames: 6, opponentGames: 4 },
      { playerGames: 6, opponentGames: 4 },
    ],
  };
  const paddedResult = computeFatigueModule([paddedMatch], [], historicalAsOfDate);
  const trimmedResult = computeFatigueModule([trimmedMatch], [], historicalAsOfDate);
  // Estimated games (6+4+6+4=20) must be identical whether or not the array is padded -- the
  // padded zero slots must not be summed in as extra games played.
  assert.equal(paddedResult.player1EstimatedGamesLast14Days, 20);
  assert.equal(paddedResult.player1EstimatedGamesLast14Days, trimmedResult.player1EstimatedGamesLast14Days);
  assert.equal(paddedResult.player1FatigueScore, trimmedResult.player1FatigueScore);

  // A match with ONLY padded {0,0} entries (no real set data at all) must not be treated as
  // "has game data" -- the has-game-data warning should still fire for that player.
  const noRealDataMatch: MatchRecord = {
    ...match("2026-06-14"),
    setGameMargins: [
      { playerGames: 0, opponentGames: 0 },
      { playerGames: 0, opponentGames: 0 },
      { playerGames: 0, opponentGames: 0 },
      { playerGames: 0, opponentGames: 0 },
      { playerGames: 0, opponentGames: 0 },
    ],
  };
  const noDataResult = computeFatigueModule([noRealDataMatch], [trimmedMatch], historicalAsOfDate);
  assert.equal(noDataResult.player1EstimatedGamesLast14Days, 0);
  assert.ok(noDataResult.warnings.some((w) => /Set-score data is missing/.test(w)));
});
