import { db, predictionsTable } from "@workspace/db";
import { asc, inArray } from "drizzle-orm";

export interface DuplicatePredictionGroup {
  /** The prediction kept as the original (earliest created). */
  keepId: number;
  /** The prediction(s) considered true duplicates of the original, to be removed. */
  removeIds: number[];
  player1Name: string;
  player2Name: string;
  tournamentName: string | null;
  predictedWinnerName: string;
}

/**
 * The ledger (`predictionsTable`) has no external match/fixture id and no separate scheduled
 * match date/time field -- it only records player names/ids, tournament, surface, format, the
 * predicted winner, and when the prediction was created. So a "true duplicate" here means: same
 * two players (order-independent), same tournament (case/whitespace-insensitive; null and empty
 * both treated as "no tournament"), same surface, and same match format -- deliberately NOT the
 * same predicted winner. In practice a single real match can only appear once in this schema, so
 * an exact match on player pair/tournament/surface/format alone is a reliable proxy for "this is
 * the same match predicted more than once" (e.g. a double-click on Predict Now, or predicting the
 * same fixture via quick-start and again via custom match) -- never used to merge two genuinely
 * different matches, since two different real matches between the same pair with the same
 * tournament/surface/format essentially cannot both exist. The predicted winner is intentionally
 * excluded from the key: the prediction engine's Monte Carlo simulator step is seeded from match
 * identity (see simulator.ts's deriveMatchSeed) so repeat predictions are now reproducible, but
 * predictions made before that fix (or via other future non-determinism) can still legitimately
 * disagree on which side they favored while still being the same real match.
 *
 * Within a duplicate group the earliest-created row (by createdAt) is always kept as the
 * original; only the later row(s) are candidates for removal. This never deletes a prediction
 * that has no duplicate, and never touches calibration/evaluation/historical-match tables --
 * only rows in the ledger's own predictionsTable.
 */
function normalizeTournamentName(name: string | null): string {
  const trimmed = (name ?? "").trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "\u0000";
}
export async function findDuplicatePredictionGroups(): Promise<DuplicatePredictionGroup[]> {
  const rows = await db
    .select({
      id: predictionsTable.id,
      player1Id: predictionsTable.player1Id,
      player1Name: predictionsTable.player1Name,
      player2Id: predictionsTable.player2Id,
      player2Name: predictionsTable.player2Name,
      tournamentName: predictionsTable.tournamentName,
      surface: predictionsTable.surface,
      matchFormat: predictionsTable.matchFormat,
      predictedWinnerId: predictionsTable.predictedWinnerId,
      predictedWinnerName: predictionsTable.predictedWinnerName,
      createdAt: predictionsTable.createdAt,
    })
    .from(predictionsTable)
    .orderBy(asc(predictionsTable.createdAt));

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const pairKey = [row.player1Id, row.player2Id].sort().join("|");
    const key = [pairKey, normalizeTournamentName(row.tournamentName), row.surface, row.matchFormat].join("::");
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const result: DuplicatePredictionGroup[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // Already ordered by createdAt ascending -- the first row is the original.
    const [original, ...dupes] = list;
    result.push({
      keepId: original.id,
      removeIds: dupes.map((d) => d.id),
      player1Name: original.player1Name,
      player2Name: original.player2Name,
      tournamentName: original.tournamentName,
      predictedWinnerName: original.predictedWinnerName,
    });
  }
  return result;
}

/**
 * Re-detects duplicate groups and deletes only the removeIds from each group (never the
 * originals, never a row with no duplicate). Re-running detection here (rather than trusting a
 * caller-supplied id list from an earlier preview) avoids acting on stale state if the ledger
 * changed between preview and confirm.
 */
export async function removeDuplicatePredictions(): Promise<{ removedCount: number; groups: DuplicatePredictionGroup[] }> {
  const groups = await findDuplicatePredictionGroups();
  const idsToRemove = groups.flatMap((g) => g.removeIds);
  if (idsToRemove.length === 0) return { removedCount: 0, groups: [] };

  await db.delete(predictionsTable).where(inArray(predictionsTable.id, idsToRemove));
  return { removedCount: idsToRemove.length, groups };
}
