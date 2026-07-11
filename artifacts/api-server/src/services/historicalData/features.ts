import type { Surface } from "../tennisData/types";

/**
 * Running, in-memory state for one player, built up strictly from matches already processed
 * (i.e. chronologically earlier) during a single backfill pass. Nothing here is ever populated
 * from a match before that match's own pre-match snapshot has already been captured and
 * written -- see `backfill.ts` for the ordering guarantee.
 */
export interface PlayerState {
  eloOverall: number;
  eloBySurface: Partial<Record<Surface, number>>;
  /** Most recent matches first. Capped to avoid unbounded memory growth over a long backfill. */
  history: Array<{
    date: Date;
    surface: Surface | null;
    won: boolean;
    /** Share of games won in this match (0-1), when set-by-set game counts were available. */
    gameShare: number | null;
  }>;
}

const STARTING_ELO = 1500;
const ELO_K = 32;
const HISTORY_CAP = 200;
const FORM_WINDOW = 10;

export function createPlayerState(): PlayerState {
  return { eloOverall: STARTING_ELO, eloBySurface: {}, history: [] };
}

export interface FeatureSnapshot {
  featureName: string;
  featureValue: number;
  /** The timestamp of the freshest fact this feature was computed from. */
  sourceTimestamp: Date;
}

/**
 * Computes every pre-match feature for a player from their state as it stood strictly before
 * the current match. Returns an empty array for a player with no prior imported matches -- we
 * do not fabricate a "default" feature value (e.g. a baseline Elo) with no real source
 * timestamp behind it; an empty snapshot honestly represents "no history yet".
 */
export function computeFeatures(state: PlayerState, surface: Surface | null): FeatureSnapshot[] {
  if (state.history.length === 0) return [];

  const lastMatch = state.history[0];
  const sourceTimestamp = lastMatch.date;
  const features: FeatureSnapshot[] = [];

  features.push({ featureName: "matchesPlayed", featureValue: state.history.length, sourceTimestamp });
  features.push({ featureName: "eloOverall", featureValue: state.eloOverall, sourceTimestamp });

  const recentForm = state.history.slice(0, FORM_WINDOW);
  const winPct = recentForm.filter((m) => m.won).length / recentForm.length;
  features.push({ featureName: "winPctLast10", featureValue: winPct, sourceTimestamp });

  const gamesKnown = recentForm.filter((m) => m.gameShare !== null);
  if (gamesKnown.length > 0) {
    const gameShare = gamesKnown.reduce((sum, m) => sum + (m.gameShare as number), 0) / gamesKnown.length;
    features.push({ featureName: "gameShareLast10", featureValue: gameShare, sourceTimestamp });
  }

  if (surface && state.eloBySurface[surface] !== undefined) {
    // sourceTimestamp for the surface-specific rating is the most recent match on that surface,
    // which may be older than the player's most recent match overall.
    const lastOnSurface = state.history.find((m) => m.surface === surface);
    features.push({
      featureName: "eloSurface",
      featureValue: state.eloBySurface[surface] as number,
      sourceTimestamp: lastOnSurface?.date ?? sourceTimestamp,
    });
  }

  return features;
}

/** Updates a player's running state with the outcome of a match they've just played, AFTER that match's snapshot has been captured. */
export function applyMatchResult(
  state: PlayerState,
  opponentEloOverall: number,
  opponentEloSurface: number | null,
  date: Date,
  surface: Surface | null,
  won: boolean,
  gameShare: number | null,
): void {
  const expected = 1 / (1 + 10 ** ((opponentEloOverall - state.eloOverall) / 400));
  state.eloOverall = state.eloOverall + ELO_K * ((won ? 1 : 0) - expected);

  if (surface) {
    const currentSurfaceElo = state.eloBySurface[surface] ?? STARTING_ELO;
    const opponentSurfaceElo = opponentEloSurface ?? STARTING_ELO;
    const expectedSurface = 1 / (1 + 10 ** ((opponentSurfaceElo - currentSurfaceElo) / 400));
    state.eloBySurface[surface] = currentSurfaceElo + ELO_K * ((won ? 1 : 0) - expectedSurface);
  }

  state.history.unshift({ date, surface, won, gameShare });
  if (state.history.length > HISTORY_CAP) state.history.length = HISTORY_CAP;
}
