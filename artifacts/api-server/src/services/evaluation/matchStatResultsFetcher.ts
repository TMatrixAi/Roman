/**
 * MatchStat results-fetcher — deduplicates provider calls across all pending predictions
 * so each player's match history is fetched exactly once per grading cycle, regardless of
 * how many pending predictions reference that player.
 *
 * The batch is built by querying both the user-facing ledger (`predictionsTable`) and the
 * live paper-trade table (`evaluationPredictionsTable`) for pending rows, collecting every
 * unique player ID, and issuing one `provider.getPlayerMatches()` call per player. The
 * active provider is typically the composite MatchStat-first / API-Tennis-fallback provider,
 * so both sources contribute automatically.
 *
 * A failure for any individual player is recorded in `fetchErrors` and does not abort the
 * fetch for other players — the batch is always returned, possibly partial.  Predictions
 * whose player fetch failed simply stay pending until the next cycle, which is preferable
 * to grading them incorrectly.
 */
import { db, predictionsTable, evaluationPredictionsTable } from "@workspace/db";
import { isNull, eq } from "drizzle-orm";
import type { MatchRecord, TennisDataProvider } from "../tennisData/types";
import { ProviderUnavailableError } from "../tennisData/types";
import { logger } from "../../lib/logger";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface MatchResultsBatch {
  /**
   * Match records keyed by player ID. Each player is fetched at most once via the
   * provider's `getPlayerMatches()` endpoint. Empty arrays signal "fetch attempted but
   * no records found" (or failed — see `fetchErrors`).
   */
  matchesByPlayerId: Map<string, MatchRecord[]>;
  /**
   * Human-readable description of each player whose fetch failed outright.
   * These players' pending predictions will remain pending until the next cycle.
   */
  fetchErrors: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Collects every unique player ID referenced by pending predictions in both the
 * user-facing ledger and the live paper-trade evaluation table.
 */
export async function collectPendingPlayerIds(): Promise<string[]> {
  const [ledger, paperTrade] = await Promise.all([
    db
      .select({ p1: predictionsTable.player1Id, p2: predictionsTable.player2Id })
      .from(predictionsTable)
      .where(isNull(predictionsTable.actualWinnerId)),
    db
      .select({ p1: evaluationPredictionsTable.player1Id, p2: evaluationPredictionsTable.player2Id })
      .from(evaluationPredictionsTable)
      .where(eq(evaluationPredictionsTable.status, "pending")),
  ]);

  const all: string[] = [];
  for (const r of ledger) {
    all.push(r.p1, r.p2);
  }
  for (const r of paperTrade) {
    all.push(r.p1, r.p2);
  }
  return [...new Set(all)];
}

// ─── Core fetch ────────────────────────────────────────────────────────────

/**
 * Fetches completed match results for a set of players, deduplicating so each player
 * is fetched at most once. Concurrently issues one `provider.getPlayerMatches()` call
 * per unique player ID and collects results into a map.
 *
 * Never throws — per-player failures are isolated and recorded in `fetchErrors`.
 * Callers should treat a player with an empty result array AND a matching fetchError
 * entry as "temporarily unavailable" rather than "has no matches".
 */
export async function fetchMatchResultsBatch(
  provider: TennisDataProvider,
  playerIds: readonly string[],
): Promise<MatchResultsBatch> {
  const unique = [...new Set(playerIds)];
  const matchesByPlayerId = new Map<string, MatchRecord[]>();
  const fetchErrors: string[] = [];

  await Promise.all(
    unique.map(async (playerId) => {
      try {
        const matches = await provider.getPlayerMatches(playerId);
        matchesByPlayerId.set(playerId, matches);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isUnavailable = err instanceof ProviderUnavailableError;
        // Rate-limit / network hiccups are expected on some cycles; log at warn.
        // Unexpected errors (malformed response, schema violation) get error.
        logger[isUnavailable ? "warn" : "error"](
          { playerId, providerName: provider.name },
          `Batch results fetch: could not load match history for player — ${msg}`,
        );
        fetchErrors.push(`Player ${playerId} (${provider.name}): ${msg}`);
        // Set an empty array so callers can distinguish "fetched, no matches" from
        // "not in this map at all" (which would be a programming error).
        matchesByPlayerId.set(playerId, []);
      }
    }),
  );

  logger.info(
    {
      provider: provider.name,
      total: unique.length,
      succeeded: unique.length - fetchErrors.length,
      failed: fetchErrors.length,
    },
    "Batch match-results fetch complete",
  );

  return { matchesByPlayerId, fetchErrors };
}
