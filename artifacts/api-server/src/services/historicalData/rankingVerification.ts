import { db, masterPlayersTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import type { TennisDataProvider } from "../tennisData/types";

export interface RankingDiscrepancy {
  playerId: string;
  playerName: string;
  /** Stored `currentRank` in master_players, or null when not set. */
  storedRank: number | null;
  /** Live rank from the provider's current standings feed. */
  providerRank: number;
  /** Absolute difference between stored and provider rank. */
  gapPlaces: number;
}

export interface RankingVerificationResult {
  computedAt: string;
  /** Total ATP + WTA player rankings returned by the live provider. */
  totalProviderRankings: number;
  /** Total players stored in master_players. */
  totalStoredPlayers: number;
  /**
   * Players whose stored rank differs from the live provider rank by more than 10 places,
   * sorted by largest gap first. Discrepancies here do NOT imply an error in the model --
   * the engine uses live-resolved rankings at prediction time, not stored ones. This report
   * is for human review of the master_players table's staleness only.
   */
  discrepancies: RankingDiscrepancy[];
}

/**
 * Compares every player in `master_players` (that has an `apiTennisKey`) against the
 * provider's current ATP/WTA standings. Players with a stored vs. live rank gap of more
 * than 10 places are reported as discrepancies and logged. Intended to be triggered
 * on-demand via the admin ranking-verification endpoint, not on every prediction.
 *
 * When the provider doesn't implement `getCurrentStandings` (e.g. a stub provider in tests),
 * this returns an empty result without erroring -- callers should surface this via the
 * `totalProviderRankings: 0` sentinel rather than treating it as a data problem.
 */
export async function runRankingVerification(provider: TennisDataProvider): Promise<RankingVerificationResult> {
  const computedAt = new Date().toISOString();

  if (!provider.getCurrentStandings) {
    logger.warn({ providerName: provider.name }, "Provider does not implement getCurrentStandings -- ranking verification skipped");
    return { computedAt, totalProviderRankings: 0, totalStoredPlayers: 0, discrepancies: [] };
  }

  const [standings, storedPlayers] = await Promise.all([
    provider.getCurrentStandings(),
    db
      .select({
        id: masterPlayersTable.id,
        displayName: masterPlayersTable.displayName,
        currentRank: masterPlayersTable.currentRank,
        apiTennisKey: masterPlayersTable.apiTennisKey,
      })
      .from(masterPlayersTable),
  ]);

  // Build a lookup from API-Tennis player key → stored row for O(1) access.
  const storedByApiKey = new Map<string, { id: string; displayName: string; currentRank: number | null }>();
  for (const p of storedPlayers) {
    if (p.apiTennisKey) storedByApiKey.set(p.apiTennisKey, p);
  }

  const discrepancies: RankingDiscrepancy[] = [];
  for (const standing of standings) {
    const stored = storedByApiKey.get(standing.playerKey);
    if (!stored) continue;
    // Gap: when stored rank is null, treat it as maximally stale (gap = provider rank itself).
    const gapPlaces = stored.currentRank != null ? Math.abs(stored.currentRank - standing.rank) : standing.rank;
    if (gapPlaces > 10) {
      discrepancies.push({
        playerId: stored.id,
        playerName: stored.displayName,
        storedRank: stored.currentRank,
        providerRank: standing.rank,
        gapPlaces,
      });
    }
  }

  // Largest discrepancy first — most actionable entries at the top.
  discrepancies.sort((a, b) => b.gapPlaces - a.gapPlaces);

  logger.info(
    {
      totalProviderRankings: standings.length,
      totalStoredPlayers: storedPlayers.length,
      discrepanciesOver10: discrepancies.length,
      largestGap: discrepancies[0]?.gapPlaces ?? 0,
    },
    "Ranking verification complete",
  );

  return {
    computedAt,
    totalProviderRankings: standings.length,
    totalStoredPlayers: storedPlayers.length,
    discrepancies,
  };
}
