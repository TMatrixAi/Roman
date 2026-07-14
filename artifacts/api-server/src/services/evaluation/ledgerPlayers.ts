import { db, predictionsTable } from "@workspace/db";
import { asc, or, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface LedgerPlayerSummary {
  id: string;
  name: string;
  predictionCount: number;
}

/** Escape LIKE/ILIKE wildcard characters (%, _) in a raw user token so they're matched literally
 * instead of acting as SQL wildcards -- otherwise a name that happens to contain "%" or "_"
 * would silently broaden or corrupt the match. */
function escapeLikeToken(token: string): string {
  return token.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Escape POSIX regex metacharacters in a raw user token so it's matched literally by `~*`. */
function escapeRegexToken(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
}

/**
 * Search players who appear (as either side) in at least one saved Ledger prediction, matched by
 * name. This is intentionally scoped to `predictionsTable` -- it never touches the live
 * tennis-data provider (see `/players/search` for that) -- so results are always "you can actually
 * jump to a recorded prediction for this player", never a live player with zero Ledger history.
 *
 * Stored names are inconsistent in both word order and punctuation (e.g. "H. Barton" vs a doubles
 * pairing like "Barros/ Leme Da Silva"), so a single whole-string substring match only ever
 * recognized a query that happened to reproduce the exact stored order and punctuation --
 * "Barton H" or "H Barton" (no period) both failed to find "H. Barton". Instead, split the query
 * into whitespace-separated words and require every word to appear as a substring SOMEWHERE in
 * the name (in any order), so first-name-first, last-name-first, and missing punctuation all
 * resolve to the same player.
 *
 * A player's id/name pairing can drift slightly over time (e.g. a display-name correction
 * upstream), so results are grouped by id with the most recently-used name shown, rather than
 * grouping by the (id, name) pair -- otherwise the same real player could show up twice.
 *
 * Stored first names are also abbreviated to a bare initial (e.g. "L. Draxl", "J. K. Trotter"),
 * while pasted names almost always spell the first name out in full (e.g. "Liam Draxl"). A plain
 * substring match can never bridge that gap -- "liam" is never a substring of "l. draxl" -- so
 * each query word is *also* accepted when it matches a same-first-letter initial token (a single
 * letter immediately followed by a period, e.g. "L.") elsewhere in the name. This is purely
 * additive to the existing substring rule: it only lets a full first name find its already-known
 * abbreviated form, it never removes or narrows any match the substring rule already found, and a
 * genuinely ambiguous surname (two distinct players who both satisfy every query word this way)
 * still surfaces as multiple candidates for the caller to resolve, not a silent pick.
 */
export async function searchLedgerPlayers(query: string): Promise<LedgerPlayerSummary[]> {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const wordConditions = sql.join(
    words.map((word) => {
      const substringMatch = sql`combined.name ilike ${`%${escapeLikeToken(word)}%`} escape '\\'`;
      const initialMatch = sql`combined.name ~* ${`(^|[^a-zA-Z])${escapeRegexToken(word[0])}\\.`}`;
      return sql`(${substringMatch} or ${initialMatch})`;
    }),
    sql` and `,
  );

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
    where ${wordConditions}
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
