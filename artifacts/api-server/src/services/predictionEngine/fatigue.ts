import type { MatchRecord } from "../tennisData/types";

export interface FatigueResult {
  player1FatigueScore: number;
  player2FatigueScore: number;
  player1MatchesLast7Days: number;
  player2MatchesLast7Days: number;
  reliability: number;
  note: string;
}

const NOTE =
  "Fatigue is estimated from real match dates in the provider's fixture history over the last 7 days; travel and surface-transition data are not available from the provider yet.";

function matchesInLast7Days(matches: MatchRecord[]): number {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  return matches.filter((m) => new Date(m.date).getTime() >= sevenDaysAgo).length;
}

export function computeFatigueModule(player1Matches: MatchRecord[], player2Matches: MatchRecord[]): FatigueResult {
  const p1Count = matchesInLast7Days(player1Matches);
  const p2Count = matchesInLast7Days(player2Matches);

  return {
    player1FatigueScore: Math.min(100, p1Count * 22),
    player2FatigueScore: Math.min(100, p2Count * 22),
    player1MatchesLast7Days: p1Count,
    player2MatchesLast7Days: p2Count,
    reliability: 70,
    note: NOTE,
  };
}
