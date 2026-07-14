import type { PlayerProfile } from "../tennisData/types";

/**
 * Substring shared by every `source: "historical-match"` disclosure this module emits. Kept as a
 * single exported constant (rather than duplicating the phrase) so `usedHistoricalMatchFallback`
 * below -- and any other caller that needs to detect this specific disclosure inside an already-
 * stored `warnings` array (e.g. the Prediction Log / Ledger list endpoints, Task #30) -- can never
 * drift out of sync with the text actually generated here.
 */
export const HISTORICAL_MATCH_FALLBACK_WARNING_MARKER = "isn't in the current live ATP/WTA standings";

/**
 * Honest, per-prediction disclosure of how each player's tour/rank were resolved (Task #22).
 * Distinguishes three real states, never collapsing them into a single silent null:
 *  - live-standings: resolved from the current ATP/WTA standings feed (the strongest case).
 *  - historical-match: not in current standings, but resolved from a real, previously-fetched
 *    match record of theirs -- real data, just not a live ranking.
 *  - neither: genuinely unresolvable from any connected source (a player we've truly never
 *    matched anywhere) -- surfaced explicitly rather than silently proceeding with tour=null.
 */
export function buildPlayerProfileWarnings(player1: PlayerProfile, player2: PlayerProfile): string[] {
  const warnings: string[] = [];

  for (const player of [player1, player2]) {
    if (player.source === "historical-match") {
      warnings.push(
        `${player.name} ${HISTORICAL_MATCH_FALLBACK_WARNING_MARKER} -- tour was resolved from their own most recent recorded match instead of a live ranking.`,
      );
    } else if (player.tour === null) {
      warnings.push(
        `${player.name}'s tour/ranking could not be verified from live standings or any previously-fetched match record -- tour-dependent signals (e.g. the segment specialist) fall back to the general model for this player.`,
      );
    }
  }

  return warnings;
}

/**
 * Task #30: detects, from an already-stored `engine.warnings` array, whether this prediction
 * involved at least one player resolved via the historical-match fallback rather than live
 * standings -- so the Prediction Log / Ledger list views can show a real disclosure badge without
 * re-deriving or guessing anything beyond what `buildPlayerProfileWarnings` already recorded at
 * prediction time. Accepts `unknown` because callers read this off a JSONB column (`engine`) or a
 * free-form `featureSnapshot`, neither of which is runtime-typed.
 */
export function usedHistoricalMatchFallback(warnings: unknown): boolean {
  if (!Array.isArray(warnings)) return false;
  return warnings.some((w) => typeof w === "string" && w.includes(HISTORICAL_MATCH_FALLBACK_WARNING_MARKER));
}
