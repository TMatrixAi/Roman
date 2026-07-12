import { db, predictionsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { getTennisDataProvider, ProviderUnavailableError, type TennisDataProvider } from "../tennisData";
import { logger } from "../../lib/logger";

/**
 * Ledger predictions (the user-facing "Custom Match"/"Predict Now" runs in predictionsTable) have
 * no scheduled fixture id or kickoff time -- unlike paper trading, they're ad-hoc "as of right
 * now" requests. So a real result can only be found the same way player-identity resolution
 * already does: pull player1's real match history and look for the real completed match against
 * player2 that happened after the prediction was made.
 */
const MIN_AGE_BEFORE_CHECKING_MS = 60 * 60_000; // give the real match time to actually be played
const BACKWARD_TOLERANCE_MS = 24 * 60 * 60_000; // small buffer for timezone rounding on the provider's match date
const FORWARD_LOOKUP_WINDOW_MS = 45 * 24 * 60 * 60_000; // ledger predictions have no known match date, so allow a generous window after creation

export interface LedgerGradingSummary {
  checked: number;
  graded: number;
  errors: string[];
}

/**
 * Checks every still-pending Ledger prediction against real completed-match data and marks it
 * Win/Loss automatically. Never guesses -- a prediction with no matching real result stays
 * pending indefinitely rather than being marked from a fabricated or approximate match.
 */
export async function gradePendingLedgerPredictions(providerOverride?: TennisDataProvider): Promise<LedgerGradingSummary> {
  const provider = providerOverride ?? getTennisDataProvider();
  const summary: LedgerGradingSummary = { checked: 0, graded: 0, errors: [] };

  const pending = await db.select().from(predictionsTable).where(isNull(predictionsTable.actualWinnerId));

  for (const row of pending) {
    if (Date.now() - row.createdAt.getTime() < MIN_AGE_BEFORE_CHECKING_MS) continue;
    summary.checked += 1;

    try {
      const matches = await provider.getPlayerMatches(row.player1Id);
      const match = matches.find((m) => {
        if (m.opponentId !== row.player2Id) return false;
        const matchTime = new Date(m.date).getTime();
        if (Number.isNaN(matchTime)) return false;
        return matchTime >= row.createdAt.getTime() - BACKWARD_TOLERANCE_MS && matchTime <= row.createdAt.getTime() + FORWARD_LOOKUP_WINDOW_MS;
      });

      if (!match) continue; // no real result surfaced yet -- stays pending, never guessed

      const winnerId = match.result === "W" ? row.player1Id : row.player2Id;
      const winnerName = winnerId === row.player1Id ? row.player1Name : row.player2Name;

      const updated = await db
        .update(predictionsTable)
        .set({ actualWinnerId: winnerId, actualWinnerName: winnerName, resolvedAt: new Date() })
        .where(and(eq(predictionsTable.id, row.id), isNull(predictionsTable.actualWinnerId)))
        .returning({ id: predictionsTable.id });

      if (updated.length > 0) summary.graded += 1;
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        summary.errors.push(`Grading ledger prediction ${row.id}: provider unavailable (${err.message})`);
        continue;
      }
      logger.error({ err, predictionId: row.id }, "Unexpected error grading ledger prediction");
      summary.errors.push(`Grading ledger prediction ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summary;
}
