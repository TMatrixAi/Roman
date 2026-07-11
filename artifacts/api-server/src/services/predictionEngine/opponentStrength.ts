import { db, matchFeatureSnapshotsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import type { MatchRecord } from "../tennisData/types";

/**
 * Opponent-strength lookup for a set of live match records, keyed by `MatchRecord.id`. Value is
 * the opponent's real, persisted `eloOverall` rating (from Phase 3's leak-proof historical
 * backfill store) at the closest point in time strictly before the match's own date. This is
 * real data derived only from actual match results already imported into the historical store --
 * never fabricated -- but it is genuinely incomplete: an opponent who has never appeared in a
 * backfilled date range has no entry, and callers must treat a missing entry as "not available",
 * not as "average opponent".
 */
export type OpponentEloLookup = Map<string, number>;

export interface OpponentStrengthResolution {
  lookup: OpponentEloLookup;
  /** Share (0-1) of the input matches for which an opponent Elo estimate was found. */
  coverage: number;
}

const EMPTY: OpponentStrengthResolution = { lookup: new Map(), coverage: 0 };

/**
 * Resolves opponent-strength estimates for every match in `matches`. Looks up each unique
 * opponent's `eloOverall` feature history (one row per match they were part of, timestamped at
 * that match's date) and, for each input match, picks the latest opponent snapshot strictly
 * before that match's date -- i.e. what was actually knowable about the opponent's strength at
 * that point in time, never a snapshot from after the fact.
 */
export async function resolveOpponentStrength(matches: MatchRecord[]): Promise<OpponentStrengthResolution> {
  if (matches.length === 0) return EMPTY;

  const opponentIds = Array.from(new Set(matches.map((m) => m.opponentId)));
  if (opponentIds.length === 0) return EMPTY;

  const rows = await db
    .select({
      playerId: matchFeatureSnapshotsTable.playerId,
      featureValue: matchFeatureSnapshotsTable.featureValue,
      sourceTimestamp: matchFeatureSnapshotsTable.sourceTimestamp,
    })
    .from(matchFeatureSnapshotsTable)
    .where(and(inArray(matchFeatureSnapshotsTable.playerId, opponentIds), eq(matchFeatureSnapshotsTable.featureName, "eloOverall")));

  const byOpponent = new Map<string, Array<{ t: number; elo: number }>>();
  for (const row of rows) {
    const list = byOpponent.get(row.playerId) ?? [];
    list.push({ t: row.sourceTimestamp.getTime(), elo: row.featureValue });
    byOpponent.set(row.playerId, list);
  }
  for (const list of byOpponent.values()) list.sort((a, b) => a.t - b.t);

  const lookup: OpponentEloLookup = new Map();
  let resolved = 0;

  for (const match of matches) {
    const history = byOpponent.get(match.opponentId);
    if (!history || history.length === 0) continue;
    const matchTime = new Date(match.date).getTime();
    if (Number.isNaN(matchTime)) continue;

    // Latest snapshot strictly before this match's own date -- never a same-day-or-later one,
    // which could leak the outcome of this very match (or a same-day later one) into its own
    // opponent-strength estimate.
    let best: number | null = null;
    for (const point of history) {
      if (point.t < matchTime) best = point.elo;
      else break;
    }
    if (best === null) continue;

    lookup.set(match.id, best);
    resolved += 1;
  }

  return { lookup, coverage: matches.length > 0 ? resolved / matches.length : 0 };
}
