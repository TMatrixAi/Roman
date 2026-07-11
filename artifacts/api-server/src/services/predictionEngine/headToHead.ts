import type { HeadToHeadRecord, Surface } from "../tennisData/types";

export interface HeadToHeadResult {
  player1Wins: number;
  player2Wins: number;
  surfaceMeetings: number;
  recentMeetings: number;
  reliability: number;
}

export function computeHeadToHeadModule(h2h: HeadToHeadRecord, surface: Surface): HeadToHeadResult {
  const player1Wins = h2h.meetings.filter((m) => m.winnerId === h2h.player1Id).length;
  const player2Wins = h2h.meetings.filter((m) => m.winnerId === h2h.player2Id).length;
  const surfaceMeetings = h2h.meetings.filter((m) => m.surface === surface).length;

  const threeYearsAgo = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000;
  const recentMeetings = h2h.meetings.filter((m) => new Date(m.date).getTime() >= threeYearsAgo).length;

  const totalMeetings = player1Wins + player2Wins;
  const reliability = Math.max(5, Math.min(100, totalMeetings * 20));

  return { player1Wins, player2Wins, surfaceMeetings, recentMeetings, reliability: Math.round(reliability) };
}
