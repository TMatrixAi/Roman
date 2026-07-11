import { db, evaluationPredictionsTable, predictionSettingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { PredictionSettingsRow } from "@workspace/db";
import type { ResultType } from "./types";

/**
 * The ONLY function in the codebase permitted to move an evaluation prediction out of
 * 'pending'. Guarded by `WHERE status = 'pending'` so a row can never be settled twice --
 * calling this on an already-graded/void/missed row is a silent no-op (returns null), never a
 * second write. There is no other update path anywhere for these rows: outcomes are never
 * edited, never deleted for losing, and never backfilled after the fact.
 */
export async function settleEvaluationPrediction(
  predictionId: number,
  outcome: {
    actualWinnerId: string | null;
    actualWinnerName: string | null;
    resultType: ResultType;
  },
  settings: Pick<PredictionSettingsRow, "retirementRule">,
): Promise<void> {
  const isVoid = outcome.resultType === "walkover" || outcome.resultType === "cancelled";
  const includedInAccuracy = !isVoid && (outcome.resultType === "normal" || settings.retirementRule === "included");

  await db
    .update(evaluationPredictionsTable)
    .set({
      status: isVoid ? "void" : "graded",
      actualWinnerId: outcome.actualWinnerId,
      actualWinnerName: outcome.actualWinnerName,
      resultType: outcome.resultType,
      includedInAccuracy,
      gradedAt: new Date(),
    })
    .where(and(eq(evaluationPredictionsTable.id, predictionId), eq(evaluationPredictionsTable.status, "pending")));
}

export async function getPredictionSettings(): Promise<PredictionSettingsRow> {
  const [existing] = await db.select().from(predictionSettingsTable).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(predictionSettingsTable).values({}).returning();
  return created;
}
