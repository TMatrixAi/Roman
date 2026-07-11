import type { MatchRecord } from "../tennisData/types";

export interface RecentFormResult {
  player1Form: number;
  player2Form: number;
  player1Trend: "improving" | "stable" | "declining";
  player2Trend: "improving" | "stable" | "declining";
  reliability: number;
}

const WINDOW = 10;

function formScore(matches: MatchRecord[]): { form: number; trend: "improving" | "stable" | "declining"; sample: number } {
  const recent = matches.slice(0, WINDOW); // matches are already sorted most-recent-first
  if (recent.length === 0) return { form: 50, trend: "stable", sample: 0 };

  let weighted = 0;
  let weightTotal = 0;
  recent.forEach((m, i) => {
    const weight = Math.pow(0.85, i); // exponential recency decay
    weighted += weight * (m.result === "W" ? 1 : 0);
    weightTotal += weight;
  });
  const form = Math.round((weighted / weightTotal) * 100);

  const half = Math.ceil(recent.length / 2);
  const newer = recent.slice(0, half);
  const older = recent.slice(half);
  const winRate = (arr: MatchRecord[]) => (arr.length ? arr.filter((m) => m.result === "W").length / arr.length : 0.5);
  const delta = winRate(newer) - winRate(older);

  const trend: "improving" | "stable" | "declining" = delta > 0.15 ? "improving" : delta < -0.15 ? "declining" : "stable";

  return { form, trend, sample: recent.length };
}

export function computeRecentFormModule(player1Matches: MatchRecord[], player2Matches: MatchRecord[]): RecentFormResult {
  const p1 = formScore(player1Matches);
  const p2 = formScore(player2Matches);
  const minSample = Math.min(p1.sample, p2.sample);
  const reliability = Math.max(10, Math.min(100, minSample * 12));

  return {
    player1Form: p1.form,
    player2Form: p2.form,
    player1Trend: p1.trend,
    player2Trend: p2.trend,
    reliability: Math.round(reliability),
  };
}
