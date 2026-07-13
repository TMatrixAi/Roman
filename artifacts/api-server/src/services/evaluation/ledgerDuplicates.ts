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
 * predicted winner, and when the prediction was created. Two ways a pair of rows are considered
 * the same real match:
 *
 * 1. Exact match: same two players (order-independent), same tournament (case/whitespace-
 *    insensitive; null and empty both treated as "no tournament"), same surface, and same match
 *    format -- deliberately NOT the same predicted winner (see below). This alone is a reliable
 *    proxy for "this is the same match predicted more than once" (e.g. a double-click on Predict
 *    Now) regardless of how far apart in time the two rows were created, since two different real
 *    matches between the same pair with identical tournament/surface/format essentially cannot
 *    both exist.
 * 2. Time-proximity fallback: same two players, created within a short window of each other
 *    (WINDOW_MS below), even when tournament/surface/format differ. This catches real observed
 *    double-submissions -- e.g. predicting the same match once via Predict Now (no tournament
 *    context) and again seconds/minutes later via Custom Match with the tournament filled in, or
 *    correcting a wrong surface/format dropdown and resubmitting -- which the exact-match key
 *    alone misses because the fields genuinely differ between the two submissions. A pair that
 *    legitimately meets again much later (weeks/months) falls outside this window and is never
 *    merged by it alone.
 *
 * The predicted winner is intentionally excluded from both keys: the prediction engine's Monte
 * Carlo simulator step is seeded from match identity (see simulator.ts's deriveMatchSeed) so
 * repeat predictions are now reproducible, but predictions made before that fix (or via other
 * future non-determinism) can still legitimately disagree on which side they favored while still
 * being the same real match.
 *
 * Rows are unioned into duplicate groups via either rule (union-find), so a chain of exact-match
 * links across a long time span still merges as before, and a chain of time-proximity links
 * merges rows created in quick succession even when their tournament/surface/format all differ
 * pairwise. Within a duplicate group the earliest-created row (by createdAt) is always kept as
 * the original; only the later row(s) are candidates for removal. This never deletes a prediction
 * that has no duplicate, and never touches calibration/evaluation/historical-match tables -- only
 * rows in the ledger's own predictionsTable.
 */
function normalizeTournamentName(name: string | null): string {
  const trimmed = (name ?? "").trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "\u0000";
}

// Realistic "same session" double-submission window: long enough to cover a user re-submitting
// after fixing a dropdown or switching entry points (Predict Now -> Custom Match) within the same
// sitting, short enough that a pair meeting again on a different day is never caught by it.
const TIME_PROXIMITY_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Minimal union-find over numeric prediction ids, used to merge rows connected by either rule. */
class UnionFind {
  private readonly parent = new Map<number, number>();
  add(id: number): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
  find(id: number): number {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
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

  const uf = new UnionFind();
  for (const row of rows) uf.add(row.id);

  // Rule 1: exact match key (pair + tournament + surface + format) -- union everyone sharing it,
  // regardless of time gap.
  const exactGroups = new Map<string, typeof rows>();
  const pairGroups = new Map<string, typeof rows>();
  for (const row of rows) {
    const pairKey = [row.player1Id, row.player2Id].sort().join("|");
    const exactKey = [pairKey, normalizeTournamentName(row.tournamentName), row.surface, row.matchFormat].join("::");

    const exactList = exactGroups.get(exactKey);
    if (exactList) exactList.push(row);
    else exactGroups.set(exactKey, [row]);

    const pairList = pairGroups.get(pairKey);
    if (pairList) pairList.push(row);
    else pairGroups.set(pairKey, [row]);
  }
  for (const list of exactGroups.values()) {
    for (let i = 1; i < list.length; i++) uf.union(list[0].id, list[i].id);
  }

  // Rule 2: same pair, created within TIME_PROXIMITY_WINDOW_MS of each other -- union those too,
  // even when tournament/surface/format differ. Rows within each pair group are already ordered
  // by createdAt ascending (from the outer query), so once a later row falls outside the window
  // from row i, every subsequent row (later still) is also outside it and the inner loop can stop.
  for (const list of pairGroups.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const gapMs = list[j].createdAt.getTime() - list[i].createdAt.getTime();
        if (gapMs > TIME_PROXIMITY_WINDOW_MS) break;
        uf.union(list[i].id, list[j].id);
      }
    }
  }

  const components = new Map<number, typeof rows>();
  for (const row of rows) {
    const root = uf.find(row.id);
    const list = components.get(root);
    if (list) list.push(row);
    else components.set(root, [row]);
  }

  const result: DuplicatePredictionGroup[] = [];
  for (const list of components.values()) {
    if (list.length < 2) continue;
    // Rows were collected in ascending id-insertion order derived from the createdAt-ordered
    // query, but union-find grouping doesn't guarantee that order is preserved -- sort explicitly
    // so the earliest-created row is always the one kept.
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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
