import type { MatchRecord, Surface, TournamentLevel } from "../tennisData/types";
import type { OpponentEloLookup } from "./opponentStrength";

export interface SurfaceEloResult {
  /** Final rating actually used for the win-probability edge -- a recency/competition-level-weighted surface-only Elo, blended toward the player's overall (cross-surface) Elo when their surface-specific sample is shallow. */
  player1SurfaceElo: number;
  player2SurfaceElo: number;
  eloDifference: number;
  /** Player 1's win probability, pulled toward 50 when the underlying rating gap is backed by high uncertainty -- see `rawEloWinProbabilityPlayer1` for the un-shrunk figure. */
  eloWinProbabilityPlayer1: number;
  /** Un-shrunk logistic win probability from `eloDifference` alone, before the uncertainty pull-to-50 is applied. Kept for transparency/debugging -- `eloWinProbabilityPlayer1` is what the ensemble actually votes with. */
  rawEloWinProbabilityPlayer1: number;
  /** Uncertainty-aware confidence (0-100), derived from each player's *effective* (recency/level-weighted) surface sample size rather than a flat count -- this now IS the same figure used to shrink `eloWinProbabilityPlayer1` toward 50. */
  reliability: number;
  /** Raw count of on-surface matches found for each player (unweighted) -- kept for existing consumers (`computeSurfaceSampleDepth`, `upsetRisk.ts`) that key off the plain match count. */
  sampleSizePlayer1: number;
  sampleSizePlayer2: number;
  /** Recency/competition-level-weighted "effective" surface sample size -- a recent Masters/Slam match counts close to 1, an old Challenger match counts a small fraction. Drives `reliability` and the overall-Elo fallback blend below. */
  effectiveSampleSizePlayer1: number;
  effectiveSampleSizePlayer2: number;
  /** Cross-surface (all-surfaces) Elo, computed with the same recency/level weighting -- the fallback rating blended in when a player's surface-specific history is thin. */
  player1OverallElo: number;
  player2OverallElo: number;
  /** Pure surface-only Elo (recency/level-weighted, but with NO overall-Elo blending) -- kept for transparency so the blend's effect is auditable. */
  player1SurfaceOnlyElo: number;
  player2SurfaceOnlyElo: number;
  /** 0-1: how much of `player1SurfaceElo`/`player2SurfaceElo` came from the overall-Elo fallback rather than the player's own surface-only rating. 0 = pure surface Elo, 1 = pure overall Elo. Fades smoothly toward 0 as the player's effective surface sample grows. */
  player1BlendWeight: number;
  player2BlendWeight: number;
  warnings: string[];
}

const STARTING_ELO = 1500;
/** Base K-factor for a full-weight (most-recent, mid-tier-competition) match -- scaled per-match by `recencyWeight()` and `levelMultiplier()` below. */
const BASE_K = 32;
const MIN_SAMPLE_FOR_NO_WARNING = 5;

/**
 * Recency half-life: a match this many days old counts for half as much toward the Elo update
 * (and toward the "effective sample size" used for confidence/blending) as a match happening
 * today. ~18 months -- long enough that a full recent season still dominates, short enough that a
 * strong surface run from several years ago doesn't silently freeze a rating that no longer
 * reflects the player's current level on that surface.
 */
const RECENCY_HALF_LIFE_DAYS = 545;
/** Floor on recency weight -- an old match still counts for a little (real history isn't erased), just heavily discounted. */
const MIN_RECENCY_WEIGHT = 0.12;

/**
 * How much a match's competition level scales its K-factor -- a Grand Slam/Masters result is
 * real signal about current top-level ability and should move the rating more than a Challenger
 * or ITF result against much weaker fields. Missing/"Other" levels use `DEFAULT_LEVEL_MULTIPLIER`
 * (never fabricated as any specific tier).
 */
const LEVEL_K_MULTIPLIER: Partial<Record<TournamentLevel, number>> = {
  GrandSlam: 1.3,
  Masters1000: 1.25,
  WTA1000: 1.25,
  ATP500: 1.1,
  WTA500: 1.1,
  ATP250: 1.0,
  WTA250: 1.0,
  Challenger: 0.75,
  ITF: 0.6,
  Other: 0.85,
};
const DEFAULT_LEVEL_MULTIPLIER = 0.85;

/** Effective-sample-size scale for the overall-Elo fallback blend: at this many effective surface matches, the blend is already down to ~37% overall / 63% surface; it keeps fading smoothly from there. */
const BLEND_EFFECTIVE_SAMPLE_SCALE = 4;
/** Effective-sample-size scale for confidence: at this many effective surface matches, confidence reaches ~63 of its max. */
const CONFIDENCE_EFFECTIVE_SAMPLE_SCALE = 6;

function levelMultiplier(level: TournamentLevel | null): number {
  if (!level) return DEFAULT_LEVEL_MULTIPLIER;
  return LEVEL_K_MULTIPLIER[level] ?? DEFAULT_LEVEL_MULTIPLIER;
}

/** Exponential decay weight (0-1, floored at `MIN_RECENCY_WEIGHT`) for a match `ageDays` before `referenceDate`. */
function recencyWeight(matchDate: string, referenceDate: string): number {
  const ageMs = new Date(referenceDate).getTime() - new Date(matchDate).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return Math.max(MIN_RECENCY_WEIGHT, Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS));
}

/**
 * Replays a chronologically-sorted set of matches into a single Elo rating, weighting each
 * match's K-factor by how recent it was (relative to `referenceDate`, the player's own most
 * recent match on record) and by its competition level. When a real opponent-strength estimate
 * is available (from Phase 3's historical store) it's used directly for that match's expected
 * score; otherwise this falls back to the league-average (starting-Elo) opponent assumption --
 * never a fabricated strength. Also returns the recency-weighted "effective sample size" -- a
 * more honest measure of how much real, still-relevant evidence backs the rating than a flat
 * match count.
 */
function replayElo(
  matches: MatchRecord[],
  opponentElo: OpponentEloLookup,
  referenceDate: string,
): { elo: number; sampleSize: number; effectiveSampleSize: number; opponentCoverage: number } {
  const sorted = [...matches].sort((a, b) => (a.date > b.date ? 1 : -1));
  let elo = STARTING_ELO;
  let covered = 0;
  let effectiveSampleSize = 0;

  for (const match of sorted) {
    const knownOpponentElo = opponentElo.get(match.id);
    if (knownOpponentElo !== undefined) covered += 1;
    const opponentReference = knownOpponentElo ?? STARTING_ELO;
    const expected = 1 / (1 + Math.pow(10, (opponentReference - elo) / 400));
    const actual = match.result === "W" ? 1 : 0;

    const recency = recencyWeight(match.date, referenceDate);
    const k = BASE_K * recency * levelMultiplier(match.tournamentLevel);
    elo += k * (actual - expected);
    effectiveSampleSize += recency;
  }

  return { elo, sampleSize: sorted.length, effectiveSampleSize, opponentCoverage: sorted.length > 0 ? covered / sorted.length : 0 };
}

interface PlayerSurfaceEloResult {
  blendedElo: number;
  surfaceOnlyElo: number;
  overallElo: number;
  blendWeight: number;
  sampleSize: number;
  effectiveSampleSize: number;
  confidence: number;
}

/**
 * Uncertainty-aware confidence (0-100) from a recency/level-weighted effective sample size, with
 * diminishing returns -- a handful of highly-relevant recent matches earns most of the available
 * confidence quickly, but confidence never fully saturates on a thin sample the way a linear
 * `sampleSize * constant` score would.
 */
function confidenceFromEffectiveSampleSize(effectiveSampleSize: number): number {
  const raw = 100 * (1 - Math.exp(-effectiveSampleSize / CONFIDENCE_EFFECTIVE_SAMPLE_SCALE));
  return Math.max(5, Math.min(100, Math.round(raw)));
}

/**
 * Computes one player's surface-specific Elo, decay/level-weighted, and blends it toward their
 * overall (cross-surface) Elo when their surface-specific effective sample is shallow. The blend
 * fades out smoothly (exponentially) as the surface effective sample grows, rather than a hard
 * cutoff -- a player with 2 real surface matches leans heavily on their overall form, a player
 * with 20 barely leans on it at all.
 */
function computePlayerSurfaceElo(matches: MatchRecord[], surface: Surface, opponentElo: OpponentEloLookup): PlayerSurfaceEloResult {
  const referenceDate = matches.length > 0 ? matches.reduce((max, m) => (m.date > max ? m.date : max), matches[0].date) : "1970-01-01";
  const onSurface = matches.filter((m) => m.surface === surface);

  const surfaceResult = replayElo(onSurface, opponentElo, referenceDate);
  const overallResult = replayElo(matches, opponentElo, referenceDate);

  const blendWeight = Math.exp(-surfaceResult.effectiveSampleSize / BLEND_EFFECTIVE_SAMPLE_SCALE);
  const blendedElo = blendWeight * overallResult.elo + (1 - blendWeight) * surfaceResult.elo;

  return {
    blendedElo,
    surfaceOnlyElo: surfaceResult.elo,
    overallElo: overallResult.elo,
    blendWeight,
    sampleSize: surfaceResult.sampleSize,
    effectiveSampleSize: surfaceResult.effectiveSampleSize,
    confidence: confidenceFromEffectiveSampleSize(surfaceResult.effectiveSampleSize),
  };
}

export function computeSurfaceEloModule(
  player1Matches: MatchRecord[],
  player2Matches: MatchRecord[],
  surface: Surface,
  player1OpponentElo: OpponentEloLookup = new Map(),
  player2OpponentElo: OpponentEloLookup = new Map(),
): SurfaceEloResult {
  const p1 = computePlayerSurfaceElo(player1Matches, surface, player1OpponentElo);
  const p2 = computePlayerSurfaceElo(player2Matches, surface, player2OpponentElo);

  const eloDifference = p1.blendedElo - p2.blendedElo;
  const rawEloWinProbabilityPlayer1 = 1 / (1 + Math.pow(10, -eloDifference / 400));

  // Weakest-link confidence -- a matchup is only as well-supported as its thinner side, matching
  // how `sampleSizePlayer1`/`sampleSizePlayer2` were already treated below.
  const reliability = Math.min(p1.confidence, p2.confidence);

  // Pull the win probability toward 50% in proportion to how uncertain the underlying rating gap
  // is -- the same rating gap backed by deep surface history should read as more decisive than
  // the same gap backed by a thin, mostly-overall-Elo-fallback sample.
  const eloWinProbabilityPlayer1 = 50 + (rawEloWinProbabilityPlayer1 * 100 - 50) * (reliability / 100);

  const warnings: string[] = [];
  const minSample = Math.min(p1.sampleSize, p2.sampleSize);
  if (minSample < MIN_SAMPLE_FOR_NO_WARNING) {
    warnings.push(`Only ${minSample} match(es) on this surface for one player -- surface Elo is low-confidence.`);
  }
  const maxBlendWeight = Math.max(p1.blendWeight, p2.blendWeight);
  if (maxBlendWeight > 0.3) {
    const blendedPlayer = p1.blendWeight >= p2.blendWeight ? "Player 1" : "Player 2";
    const pct = Math.round(maxBlendWeight * 100);
    warnings.push(`${blendedPlayer}'s surface history is shallow -- their surface Elo is blended ${pct}% toward their overall (cross-surface) Elo.`);
  }
  if (surface === "Hard") {
    warnings.push("Indoor vs outdoor hard-court split is only known for major tournaments; most Hard matches are treated as one pool.");
  }

  return {
    player1SurfaceElo: Math.round(p1.blendedElo),
    player2SurfaceElo: Math.round(p2.blendedElo),
    eloDifference: Math.round(eloDifference),
    eloWinProbabilityPlayer1: Math.round(eloWinProbabilityPlayer1 * 10) / 10,
    rawEloWinProbabilityPlayer1: Math.round(rawEloWinProbabilityPlayer1 * 1000) / 10,
    reliability: Math.round(reliability),
    sampleSizePlayer1: p1.sampleSize,
    sampleSizePlayer2: p2.sampleSize,
    effectiveSampleSizePlayer1: Math.round(p1.effectiveSampleSize * 10) / 10,
    effectiveSampleSizePlayer2: Math.round(p2.effectiveSampleSize * 10) / 10,
    player1OverallElo: Math.round(p1.overallElo),
    player2OverallElo: Math.round(p2.overallElo),
    player1SurfaceOnlyElo: Math.round(p1.surfaceOnlyElo),
    player2SurfaceOnlyElo: Math.round(p2.surfaceOnlyElo),
    player1BlendWeight: Math.round(p1.blendWeight * 1000) / 1000,
    player2BlendWeight: Math.round(p2.blendWeight * 1000) / 1000,
    warnings,
  };
}
