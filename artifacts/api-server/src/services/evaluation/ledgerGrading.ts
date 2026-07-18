/**
 * Ledger prediction grading — marks user-facing "Custom Match"/"Predict Now" predictions
 * Win/Loss once a real result becomes available.
 *
 * ### Design principles
 * - **Never guess.** A prediction with no confident matching real result stays pending
 *   indefinitely rather than being marked from an approximate or ambiguous match.
 * - **Batch-first.** The primary grading path accepts a pre-fetched `MatchResultsBatch`
 *   so the caller can share provider round-trips across both ledger and paper-trade
 *   grading without redundant API calls.
 * - **Idempotent.** Every DB update is guarded by `WHERE actualWinnerId IS NULL` so
 *   calling this concurrently or repeatedly is safe; the DB trigger also enforces
 *   settle-once semantics for `evaluationPredictions`.
 * - **Ambiguous = pending.** When the batch fetch for a player failed (provider rate-
 *   limited, network error, etc.) the prediction stays pending — never incorrectly graded.
 *   The failure is logged and surfaced in the returned summary's `errors` list.
 */
import { db, predictionsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { getTennisDataProvider, ProviderUnavailableError, type TennisDataProvider } from "../tennisData";
import { collectPendingPlayerIds, fetchMatchResultsBatch, type MatchResultsBatch } from "./tennisResultsFetcher";
import { logger } from "../../lib/logger";

// ─── Time-window constants ──────────────────────────────────────────────────

/** Give the real match time to be played before checking (avoids false "no result yet"). */
const MIN_AGE_BEFORE_CHECKING_MS = 60 * 60_000;
/** Small buffer for timezone rounding in the provider's match date. */
const BACKWARD_TOLERANCE_MS = 24 * 60 * 60_000;
/** Ledger predictions have no known scheduled date — allow a generous forward window after creation. */
const FORWARD_LOOKUP_WINDOW_MS = 45 * 24 * 60 * 60_000;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LedgerGradingSummary {
  /** Pending predictions old enough to check for a real result. */
  checked: number;
  /** Predictions actually marked Win/Loss this run. */
  graded: number;
  /** Human-readable error descriptions for any unexpected failures. */
  errors: string[];
  /**
   * IDs of predictions that were checked but had no matching result yet.
   * These stay pending and will be retried next cycle — not an error condition.
   * Logged at debug level to avoid noise; included here for job-level telemetry.
   */
  unresolvedIds: number[];
}

// ─── Batch-based grading (primary path) ───────────────────────────────────

/**
 * Grades all currently-pending ledger predictions using a pre-fetched
 * `MatchResultsBatch`. Each prediction is matched against the batch's per-player
 * match history; no additional provider calls are made.
 *
 * Predictions whose player's batch fetch failed (empty array + an error in
 * `batch.fetchErrors`) are left pending — they'll be retried on the next cycle.
 * The returned summary's `errors` includes the batch fetch errors for visibility.
 */
export async function gradePendingLedgerPredictionsFromBatch(
  batch: MatchResultsBatch,
): Promise<LedgerGradingSummary> {
  const summary: LedgerGradingSummary = { checked: 0, graded: 0, errors: [...batch.fetchErrors], unresolvedIds: [] };

  const pending = await db.select().from(predictionsTable).where(isNull(predictionsTable.actualWinnerId));

  for (const row of pending) {
    if (Date.now() - row.createdAt.getTime() < MIN_AGE_BEFORE_CHECKING_MS) continue;
    summary.checked += 1;

    // Use pre-fetched results for this player — an empty array means either
    // "genuinely no matches yet" or "fetch failed"; both cases leave the prediction pending.
    const matches = batch.matchesByPlayerId.get(row.player1Id) ?? [];

    const match = matches.find((m) => {
      if (m.opponentId !== row.player2Id) return false;
      const matchTime = new Date(m.date).getTime();
      if (Number.isNaN(matchTime)) return false;
      return (
        matchTime >= row.createdAt.getTime() - BACKWARD_TOLERANCE_MS &&
        matchTime <= row.createdAt.getTime() + FORWARD_LOOKUP_WINDOW_MS
      );
    });

    if (!match) {
      // No result yet — this is normal for recent predictions. Log at debug, not warn.
      logger.debug(
        { predictionId: row.id, player1Id: row.player1Id, player2Id: row.player2Id },
        "Ledger grading: no matching result in batch yet — prediction stays pending",
      );
      summary.unresolvedIds.push(row.id);
      continue;
    }

    try {
      const winnerId = match.result === "W" ? row.player1Id : row.player2Id;
      const winnerName = winnerId === row.player1Id ? row.player1Name : row.player2Name;

      const updated = await db
        .update(predictionsTable)
        .set({ actualWinnerId: winnerId, actualWinnerName: winnerName, resolvedAt: new Date() })
        .where(and(eq(predictionsTable.id, row.id), isNull(predictionsTable.actualWinnerId)))
        .returning({ id: predictionsTable.id });

      if (updated.length > 0) {
        summary.graded += 1;
        logger.info(
          { predictionId: row.id, winnerId, player1Id: row.player1Id, player2Id: row.player2Id },
          "Ledger prediction graded from tennis results batch",
        );
      }
      // updated.length === 0 means another writer already settled it — silent no-op, correct.
    } catch (err) {
      logger.error({ err, predictionId: row.id }, "Unexpected error grading ledger prediction from batch");
      summary.errors.push(`Grading ledger prediction ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (summary.unresolvedIds.length > 0) {
    logger.info(
      { count: summary.unresolvedIds.length, ids: summary.unresolvedIds.slice(0, 10) },
      "Ledger grading: predictions still awaiting a real result (not errors — normal pending state)",
    );
  }

  return summary;
}

// ─── Convenience wrapper (backward-compatible entry point) ─────────────────

/**
 * Checks every still-pending Ledger prediction against real completed-match data
 * and marks it Win/Loss automatically. Never guesses — a prediction with no
 * matching real result stays pending indefinitely rather than being marked from a
 * fabricated or approximate match.
 *
 * Internally: collects unique player IDs from all pending predictions, fetches
 * their match histories in one deduplicated batch (one provider call per player,
 * not one per prediction), then delegates to `gradePendingLedgerPredictionsFromBatch`.
 *
 * If the provider is unavailable, the error is captured in the returned summary and
 * no predictions are incorrectly graded.
 */
export async function gradePendingLedgerPredictions(providerOverride?: TennisDataProvider): Promise<LedgerGradingSummary> {
  const provider = providerOverride ?? getTennisDataProvider();

  // Collect only the player IDs needed for pending ledger predictions (not paper trades —
  // the job that calls this already pre-fetches a shared batch for paper trades separately).
  const pending = await db
    .select({ p1: predictionsTable.player1Id, p2: predictionsTable.player2Id })
    .from(predictionsTable)
    .where(isNull(predictionsTable.actualWinnerId));

  const playerIds = [...new Set(pending.flatMap((r) => [r.p1, r.p2]))];

  if (playerIds.length === 0) {
    return { checked: 0, graded: 0, errors: [], unresolvedIds: [] };
  }

  let batch: MatchResultsBatch;
  try {
    batch = await fetchMatchResultsBatch(provider, playerIds);
  } catch (err) {
    // fetchMatchResultsBatch itself should never throw (it catches per-player),
    // but guard against any unexpected failure at the outer level.
    const msg = err instanceof ProviderUnavailableError
      ? `Provider unavailable: ${err.message}`
      : `Unexpected error building results batch: ${err instanceof Error ? err.message : String(err)}`;
    logger.error({ err }, msg);
    return { checked: 0, graded: 0, errors: [msg], unresolvedIds: [] };
  }

  return gradePendingLedgerPredictionsFromBatch(batch);
}
