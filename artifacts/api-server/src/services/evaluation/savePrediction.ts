import { db, predictionsTable, type InsertPrediction, type PredictionRow } from "@workspace/db";
import { eq, and } from "drizzle-orm";

/**
 * Inserts a new prediction row, or -- when a row already exists with the exact same
 * `matchIdentityKey` + `inputSnapshotHash` (see `predictionEngine/predictionIdentity.ts`) --
 * returns that existing row untouched instead of inserting a duplicate or overwriting it.
 * Enforced atomically via the DB-level `predictions_identity_input_snapshot_idx` unique
 * constraint (see `lib/db/src/schema/predictions.ts`), so this is safe even under concurrent
 * requests for the same match+inputs.
 *
 * A request for the same match with a DIFFERENT input snapshot (e.g. newer match history pulled
 * in since the last prediction) has a different `inputSnapshotHash` and is unaffected by this
 * constraint -- it always inserts a new row.
 *
 * Task #150: identical `matchIdentityKey` + `inputSnapshotHash` means the resolved inputs were
 * byte-for-byte the same, so there is never a legitimate reason to rewrite the stored prediction
 * -- only the caller's own engine logic could have changed between the two requests, and that is
 * exactly the kind of after-the-fact edit this table must not allow. This used to update the row
 * in place as long as the match hadn't resolved yet (guarded only by a `setWhere` on
 * `actualWinnerId`/`resolvedAt`), which meant a repeat "Predict Now" click for a still-unresolved
 * match -- after a scoring-logic change, with no change to the inputs themselves -- could silently
 * rewrite the original `calibratedProbability`/`recommendation` before anyone graded it. The
 * conflict now always resolves to a no-op (`onConflictDoNothing`): the first stored prediction for
 * a given match+inputs always wins, resolved or not.
 */
export async function saveOrUpdatePrediction(values: InsertPrediction): Promise<PredictionRow> {
  const [saved] = await db
    .insert(predictionsTable)
    .values(values)
    .onConflictDoNothing({
      target: [predictionsTable.matchIdentityKey, predictionsTable.inputSnapshotHash],
    })
    .returning();

  if (saved) return saved;

  // The conflict was a no-op (a row for this match+inputs already exists), so `returning()` came
  // back empty -- look the existing row up directly and return it unchanged.
  const [existing] = await db
    .select()
    .from(predictionsTable)
    .where(and(eq(predictionsTable.matchIdentityKey, values.matchIdentityKey), eq(predictionsTable.inputSnapshotHash, values.inputSnapshotHash)));
  if (!existing) throw new Error("saveOrUpdatePrediction: insert/update returned no row and none found on lookup");
  return existing;
}
