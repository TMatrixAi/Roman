import type { PlayerProfile } from "../tennisData/types";

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
        `${player.name} isn't in the current live ATP/WTA standings -- tour was resolved from their own most recent recorded match instead of a live ranking.`,
      );
    } else if (player.tour === null) {
      warnings.push(
        `${player.name}'s tour/ranking could not be verified from live standings or any previously-fetched match record -- tour-dependent signals (e.g. the segment specialist) fall back to the general model for this player.`,
      );
    }
  }

  return warnings;
}
