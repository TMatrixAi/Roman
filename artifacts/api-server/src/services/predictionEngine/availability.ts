import type { MatchRecord } from "../tennisData/types";
import { inferVenue, type Venue } from "./venueMap";

export interface PlayerAvailability {
  /** Exact real days between a player's most recent completed match and this one. Null when the player has no prior match on record at all. */
  daysSinceLastMatch: number | null;
  /** Great-circle distance (km) between the venue of a player's most recent match and this match's venue, computed from real, verified venue coordinates. Null when either venue can't be resolved, or there's no prior match. */
  travelDistanceKm: number | null;
  /**
   * True only when the player's own real match record shows they retired or received a
   * walkover-related result within the lookback window -- a genuine recorded fact, not a
   * diagnosis of an ongoing injury. Retirement always means the loser retired mid-match
   * (`retired && result === "L"`), so this only fires for the player who actually stopped play.
   */
  recentRetirementOrWithdrawal: boolean;
  /** The tournament name of the match that produced `recentRetirementOrWithdrawal`, for disclosure. Null when the flag is false. */
  recentRetirementTournament: string | null;
}

export interface AvailabilityResult {
  player1: PlayerAvailability;
  player2: PlayerAvailability;
  reliability: number;
  note: string;
  warnings: string[];
}

// A retirement/walkover more than this many days ago is treated as fully resolved (no signal) --
// there's no verified data on actual recovery time, so this window is a documented, conservative
// modeling choice (roughly one full tour cycle back to the same event), not a medical claim.
const RECENT_RETIREMENT_WINDOW_DAYS = 21;

const EARTH_RADIUS_KM = 6371;

function haversineKm(a: Venue, b: Venue): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return Math.round(EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function mostRecentMatch(matches: MatchRecord[]): MatchRecord | null {
  if (matches.length === 0) return null;
  // Callers already sort matches newest-first, but don't assume it -- pick the max by date directly.
  return matches.reduce((latest, m) => (new Date(m.date).getTime() > new Date(latest.date).getTime() ? m : latest));
}

function computeOnePlayer(matches: MatchRecord[], currentVenue: Venue | null, now: Date, warnings: string[], playerLabel: string): PlayerAvailability {
  const last = mostRecentMatch(matches);

  let daysSinceLastMatch: number | null = null;
  let travelDistanceKm: number | null = null;
  if (last) {
    const lastDate = new Date(last.date);
    daysSinceLastMatch = Math.max(0, Math.round((now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000)));

    const lastVenue = inferVenue(last.tournamentName);
    if (lastVenue && currentVenue) {
      travelDistanceKm = haversineKm(lastVenue, currentVenue);
    } else {
      warnings.push(`${playerLabel}: travel distance unavailable -- the venue for this match and/or ${playerLabel}'s most recent tournament isn't in the known-venue list.`);
    }
  } else {
    warnings.push(`${playerLabel}: no prior match history at all -- rest days and travel distance can't be computed.`);
  }

  const cutoff = now.getTime() - RECENT_RETIREMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recentRetirement = matches.find((m) => m.retired && m.result === "L" && new Date(m.date).getTime() >= cutoff) ?? null;

  return {
    daysSinceLastMatch,
    travelDistanceKm,
    recentRetirementOrWithdrawal: recentRetirement !== null,
    recentRetirementTournament: recentRetirement?.tournamentName ?? null,
  };
}

/**
 * Real injury/travel/rest signals, built entirely from verified data already on hand -- no
 * external injury-news feed was found to be reachable from this environment (RAPIDAPI_KEY and
 * API_SPORTS_KEY are present but neither resolves to a live, subscribed tennis data source as of
 * 2026-07-11 -- see docs/audit-phase4-availability.md). Rather than fabricate a "current fitness"
 * score that looks verified but isn't, this module reports three things it CAN verify:
 *   1. Exact rest days since each player's last real completed match.
 *   2. Real travel distance between that match's venue and this one, using the same verified
 *      venue coordinates the weather module already relies on (`venueMap.ts`) -- coverage is
 *      therefore limited to the same set of recognized tournaments today.
 *   3. Whether a player's own match record shows they retired mid-match (i.e. they were the
 *      losing side of a `retired` result) within the last few weeks -- a real recorded fact that
 *      is a meaningful (not proof-positive) indicator of a recent physical issue.
 * Withdrawal *before* a ball is struck (the case this module can't see) still has no verified
 * source connected -- that gap is disclosed explicitly in the engine's `availabilityNote`, never
 * silently assumed away.
 */
export function computeAvailabilityModule(
  player1Matches: MatchRecord[],
  player2Matches: MatchRecord[],
  tournamentName: string | null | undefined,
  now: Date = new Date(),
): AvailabilityResult {
  const currentVenue = inferVenue(tournamentName);
  const warnings: string[] = [];
  if (!currentVenue) {
    warnings.push("This match's venue isn't in the known-venue list -- travel distance can't be computed for either player.");
  }

  const player1 = computeOnePlayer(player1Matches, currentVenue, now, warnings, "Player 1");
  const player2 = computeOnePlayer(player2Matches, currentVenue, now, warnings, "Player 2");

  // Reliability reflects how much of this module is actually backed by resolvable data for THIS
  // match, not a flat constant -- rest days need only a prior match (usually available); travel
  // needs two resolved venues (much rarer, gated by venueMap's current ~18-tournament coverage).
  let resolvedSignals = 0;
  const totalSignals = 4; // rest x2, travel x2
  if (player1.daysSinceLastMatch !== null) resolvedSignals++;
  if (player2.daysSinceLastMatch !== null) resolvedSignals++;
  if (player1.travelDistanceKm !== null) resolvedSignals++;
  if (player2.travelDistanceKm !== null) resolvedSignals++;
  const reliability = Math.round((resolvedSignals / totalSignals) * 100);

  return {
    player1,
    player2,
    reliability,
    note:
      "Rest days and recent-retirement flags are real, derived from each player's actual match record. Travel distance is a real great-circle calculation between verified venue coordinates, but only available when both the last and current tournaments are in the known-venue list. Pre-match withdrawal/injury status (before a match starts) has no verified data source connected -- see the prediction's availability disclosure.",
    warnings,
  };
}
