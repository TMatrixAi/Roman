import type { MatchRecord, Surface } from "../tennisData/types";
import type { OpponentEloLookup } from "./opponentStrength";

export interface SurfaceEloResult {
  player1SurfaceElo: number;
  player2SurfaceElo: number;
  eloDifference: number;
  eloWinProbabilityPlayer1: number;
  reliability: number;
  sampleSizePlayer1: number;
  sampleSizePlayer2: number;
  warnings: string[];
}

const STARTING_ELO = 1500;
const K_FACTOR = 32;
const MIN_SAMPLE_FOR_NO_WARNING = 5;

/**
 * Computes a surface-specific Elo rating from real match results, replayed chronologically. When
 * a real opponent-strength estimate is available (from Phase 3's historical store) it's used
 * directly for that match's expected score; otherwise this falls back to the original
 * league-average (starting-Elo) opponent assumption -- never a fabricated strength.
 */
function computeSurfaceElo(
  matches: MatchRecord[],
  surface: Surface,
  opponentElo: OpponentEloLookup,
): { elo: number; sampleSize: number; opponentCoverage: number } {
  const onSurface = matches.filter((m) => m.surface === surface).sort((a, b) => (a.date > b.date ? 1 : -1));
  let elo = STARTING_ELO;
  let covered = 0;
  for (const match of onSurface) {
    const knownOpponentElo = opponentElo.get(match.id);
    if (knownOpponentElo !== undefined) covered += 1;
    const opponentReference = knownOpponentElo ?? STARTING_ELO;
    const expected = 1 / (1 + Math.pow(10, (opponentReference - elo) / 400));
    const actual = match.result === "W" ? 1 : 0;
    elo += K_FACTOR * (actual - expected);
  }
  return { elo, sampleSize: onSurface.length, opponentCoverage: onSurface.length > 0 ? covered / onSurface.length : 0 };
}

export function computeSurfaceEloModule(
  player1Matches: MatchRecord[],
  player2Matches: MatchRecord[],
  surface: Surface,
  player1OpponentElo: OpponentEloLookup = new Map(),
  player2OpponentElo: OpponentEloLookup = new Map(),
): SurfaceEloResult {
  const p1 = computeSurfaceElo(player1Matches, surface, player1OpponentElo);
  const p2 = computeSurfaceElo(player2Matches, surface, player2OpponentElo);

  const eloDifference = p1.elo - p2.elo;
  const eloWinProbabilityPlayer1 = 1 / (1 + Math.pow(10, -eloDifference / 400));

  const minSample = Math.min(p1.sampleSize, p2.sampleSize);
  const reliability = Math.max(5, Math.min(100, minSample * 12));

  const warnings: string[] = [];
  if (minSample < MIN_SAMPLE_FOR_NO_WARNING) {
    warnings.push(`Only ${minSample} match(es) on this surface for one player -- surface Elo is low-confidence.`);
  }
  if (surface === "Hard") {
    warnings.push("Indoor vs outdoor hard-court split is only known for major tournaments; most Hard matches are treated as one pool.");
  }

  return {
    player1SurfaceElo: Math.round(p1.elo),
    player2SurfaceElo: Math.round(p2.elo),
    eloDifference: Math.round(eloDifference),
    eloWinProbabilityPlayer1: Math.round(eloWinProbabilityPlayer1 * 1000) / 10,
    reliability: Math.round(reliability),
    sampleSizePlayer1: p1.sampleSize,
    sampleSizePlayer2: p2.sampleSize,
    warnings,
  };
}
