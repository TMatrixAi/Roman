import { db, predictionsTable } from "@workspace/db";
import { asc, or, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface LedgerPlayerSummary {
  id: string;
  name: string;
  predictionCount: number;
}

/**
 * Search players who appear (as either side) in at least one saved Ledger prediction, matched by
 * name substring. This is intentionally scoped to `predictionsTable` -- it never touches the live
 * tennis-data provider (see `/players/search` for that) -- so results are always "you can actually
 * jump to a recorded prediction for this player", never a live player with zero Ledger history.
 *
 * A player's id/name pairing can drift slightly over time (e.g. a display-name correction
 * upstream), so results are grouped by id with the most recently-used name shown, rather than
 * grouping by the (id, name) pair -- otherwise the same real player could show up twice.
 */
export async function searchLedgerPlayers(query: string): Promise<LedgerPlayerSummary[]> {
  const pattern = `%${query}%`;
  const result = await db.execute<{ id: string; name: string; prediction_count: number }>(sql`
    select
      combined.id as id,
      (array_agg(combined.name order by combined.created_at desc))[1] as name,
      count(*)::int as prediction_count
    from (
      select player1_id as id, player1_name as name, created_at from ${predictionsTable}
      union all
      select player2_id as id, player2_name as name, created_at from ${predictionsTable}
    ) as combined
    where combined.name ilike ${pattern}
    group by combined.id
    order by prediction_count desc, name asc
    limit 20
  `);

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    predictionCount: row.prediction_count,
  }));
}

/**
 * Every saved Ledger prediction involving a given player id (either side of the matchup),
 * oldest-created first. Unlike `GET /predictions` this is never capped by a page-size limit --
 * it backs the Ledger's player-navigation control, which must be able to step through a player's
 * entire recorded history, including predictions older than whatever the main list currently
 * shows.
 */
export async function getPredictionsForPlayer(playerId: string) {
  return db
    .select()
    .from(predictionsTable)
    .where(or(eq(predictionsTable.player1Id, playerId), eq(predictionsTable.player2Id, playerId)))
    .orderBy(asc(predictionsTable.createdAt));
}
