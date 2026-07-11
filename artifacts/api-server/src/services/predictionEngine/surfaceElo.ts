import type { MatchRecord, Surface } from "../tennisData/types";

export interface SurfaceEloResult {
  player1SurfaceElo: number;
  player2SurfaceElo: number;
  eloDifference: number;
  eloWinProbabilityPlayer1: number;
  reliability: number;
  sampleSizePlayer1: number;
  sampleSizePlayer2: number;
}

const STARTING_ELO = 1500;
const K_FACTOR = 32;

/** Computes a simple surface-specific Elo rating purely from real match results (chronological win/loss). */
function computeSurfaceElo(matches: MatchRecord[], surface: Surface): { elo: number; sampleSize: number } {
  const onSurface = matches.filter((m) => m.surface === surface).sort((a, b) => (a.date > b.date ? 1 : -1));
  let elo = STARTING_ELO;
  for (const match of onSurface) {
    // Without a real opponent-Elo feed, treat every result as being against a league-average
    // (starting-Elo) opponent -- a common simplification when only win/loss is available.
    const expected = 1 / (1 + Math.pow(10, (STARTING_ELO - elo) / 400));
    const actual = match.result === "W" ? 1 : 0;
    elo += K_FACTOR * (actual - expected);
  }
  return { elo, sampleSize: onSurface.length };
}

export function computeSurfaceEloModule(
  player1Matches: MatchRecord[],
  player2Matches: MatchRecord[],
  surface: Surface,
): SurfaceEloResult {
  const p1 = computeSurfaceElo(player1Matches, surface);
  const p2 = computeSurfaceElo(player2Matches, surface);

  const eloDifference = p1.elo - p2.elo;
  const eloWinProbabilityPlayer1 = 1 / (1 + Math.pow(10, -eloDifference / 400));

  const minSample = Math.min(p1.sampleSize, p2.sampleSize);
  const reliability = Math.max(5, Math.min(100, minSample * 12));

  return {
    player1SurfaceElo: Math.round(p1.elo),
    player2SurfaceElo: Math.round(p2.elo),
    eloDifference: Math.round(eloDifference),
    eloWinProbabilityPlayer1: Math.round(eloWinProbabilityPlayer1 * 1000) / 10,
    reliability: Math.round(reliability),
    sampleSizePlayer1: p1.sampleSize,
    sampleSizePlayer2: p2.sampleSize,
  };
}
