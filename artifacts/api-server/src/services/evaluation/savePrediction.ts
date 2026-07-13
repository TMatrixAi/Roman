import { db, predictionsTable, type InsertPrediction, type PredictionRow } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

/**
 * Inserts a new prediction row, or -- when a row already exists with the exact same
 * `matchIdentityKey` + `inputSnapshotHash` (see `predictionEngine/predictionIdentity.ts`) --
 * updates that existing row in place instead of inserting a duplicate. Enforced atomically via
 * the DB-level `predictions_identity_input_snapshot_idx` unique constraint (see
 * `lib/db/src/schema/predictions.ts`), so this is safe even under concurrent requests for the
 * same match+inputs.
 *
 * A request for the same match with a DIFFERENT input snapshot (e.g. newer match history pulled
 * in since the last prediction) has a different `inputSnapshotHash` and is unaffected by this
 * constraint -- it always inserts a new row.
 *
 * Once a row has recorded a real outcome (`actualWinnerId`/`resolvedAt` set), it is a settled
 * historical record, not a live draft -- an identical-input resubmission must never rewrite its
 * predicted winner, probabilities, recommendation, or engine breakdown after the fact, since that
 * would retroactively change what the ledger/accuracy dashboards say the model "predicted" for an
 * already-graded bet. The `WHERE` clause below makes the update a no-op once the row is resolved;
 * the conflict still resolves to that same existing row (never a duplicate insert), it's just left
 * untouched.
 */
export async function saveOrUpdatePrediction(values: InsertPrediction): Promise<PredictionRow> {
  const [saved] = await db
    .insert(predictionsTable)
    .values(values)
    .onConflictDoUpdate({
      target: [predictionsTable.matchIdentityKey, predictionsTable.inputSnapshotHash],
      set: {
        player1Name: values.player1Name,
        player2Name: values.player2Name,
        tournamentLevel: values.tournamentLevel,
        tournamentName: values.tournamentName,
        predictedWinnerId: values.predictedWinnerId,
        predictedWinnerName: values.predictedWinnerName,
        calibratedProbability: values.calibratedProbability,
        predictedWinnerProbability: values.predictedWinnerProbability,
        dataQuality: values.dataQuality,
        dataQualityLabel: values.dataQualityLabel,
        upsetRisk: values.upsetRisk,
        recommendation: values.recommendation,
        predictedSetScore: values.predictedSetScore,
        engine: values.engine,
      },
      setWhere: sql`${predictionsTable.actualWinnerId} IS NULL AND ${predictionsTable.resolvedAt} IS NULL`,
    })
    .returning();

  if (saved) return saved;

  // `setWhere` made the conflict update a no-op (the existing row is already resolved/graded), so
  // `returning()` came back empty -- look the settled row up directly and return it unchanged.
  const [existing] = await db
    .select()
    .from(predictionsTable)
    .where(and(eq(predictionsTable.matchIdentityKey, values.matchIdentityKey), eq(predictionsTable.inputSnapshotHash, values.inputSnapshotHash)));
  if (!existing) throw new Error("saveOrUpdatePrediction: insert/update returned no row and none found on lookup");
  return existing;
}
