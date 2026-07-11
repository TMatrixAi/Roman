import { and, desc, eq, sql } from "drizzle-orm";
import { db, historicalMatchesTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import type { PlayerProfile, PlayerSummary, TennisDataProvider } from "./types";

/**
 * Real cross-source player identity resolution (Task #22). API-Tennis (the only reachable tennis
 * data provider in this environment -- see docs/audit-task22-player-coverage.md, which
 * re-verified live on 2026-07-11 that API_SPORTS_KEY and RAPIDAPI_KEY still have no working,
 * subscribed tennis endpoint) has no name-search endpoint and scopes `get_standings` to current
 * ATP/WTA top rankings only. That leaves Challenger/ITF-only players, and recently-retired or
 * -returning players outside the current top rankings, genuinely unsearchable by name and
 * missing a `tour` from `getPlayer` alone.
 *
 * This module supplements the provider with our OWN previously-fetched, already-verified real
 * match history (`historical_matches`, populated by the backfill pipeline and by paper-trading
 * grading) as a second real identity source -- never a fuzzy guess, never fabricated: every row
 * matched here is an exact `player_key` the provider itself reported on a real match. A player
 * found ONLY this way is always labeled `source: "historical-match"` so callers (and the UI) can
 * distinguish it from a live-standings-verified profile, per Task #22's "clearly disclosed, not
 * silently dropped" requirement.
 */

/** Doubles fixtures store the pair as one "player" with a "/"-joined name (e.g. "Collignon/ Kasnikowski") -- exclude those from singles player identity lookups. */
function isSinglesName(name: string): boolean {
  return !name.includes("/");
}

interface HistoricalPlayerRow {
  id: string;
  name: string;
  tour: string | null;
}

/** Most recent real historical-match sighting of a given player_key, or null if we've never seen them. */
async function findMostRecentHistoricalSighting(playerId: string): Promise<HistoricalPlayerRow | null> {
  const [asPlayer1, asPlayer2] = await Promise.all([
    db
      .select({ id: historicalMatchesTable.player1Id, name: historicalMatchesTable.player1Name, tour: historicalMatchesTable.tour, scheduledStartAt: historicalMatchesTable.scheduledStartAt })
      .from(historicalMatchesTable)
      .where(eq(historicalMatchesTable.player1Id, playerId))
      .orderBy(desc(historicalMatchesTable.scheduledStartAt))
      .limit(1),
    db
      .select({ id: historicalMatchesTable.player2Id, name: historicalMatchesTable.player2Name, tour: historicalMatchesTable.tour, scheduledStartAt: historicalMatchesTable.scheduledStartAt })
      .from(historicalMatchesTable)
      .where(eq(historicalMatchesTable.player2Id, playerId))
      .orderBy(desc(historicalMatchesTable.scheduledStartAt))
      .limit(1),
  ]);

  const candidates = [...asPlayer1, ...asPlayer2].filter((row) => isSinglesName(row.name));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.scheduledStartAt.getTime() - a.scheduledStartAt.getTime());
  const best = candidates[0];
  return { id: best.id, name: best.name, tour: best.tour };
}

/**
 * Resolves a player profile the way every prediction route needs: try the live provider first
 * (works for ANY known player_key, not just standings-listed ones -- confirmed live 2026-07-11
 * against a real Challenger-only player_key), and when the provider found them but couldn't
 * attach a live tour/rank (not in current standings), fall back to their own most recent real
 * historical match record for `tour` -- honestly labeled `source: "historical-match"`, never
 * presented as a live ranking.
 *
 * Returns null only when the provider itself has no record of this player_key at all -- the one
 * case that really is "not found", unchanged from before.
 */
export async function resolvePlayerProfile(provider: TennisDataProvider, playerId: string): Promise<PlayerProfile | null> {
  const player = await provider.getPlayer(playerId);
  if (!player) return null;
  if (player.tour !== null) return player; // already resolved from live standings

  const sighting = await findMostRecentHistoricalSighting(playerId);
  if (!sighting || sighting.tour === null) {
    // Genuinely unresolvable from any connected source -- leave tour null and source undefined
    // rather than guessing. Callers building prediction warnings should treat this distinctly
    // from a player who simply hasn't had their historical match data fetched yet.
    return player;
  }

  logger.info({ playerId, tour: sighting.tour }, "Resolved player tour from historical match record (not in current live standings)");
  return { ...player, tour: sighting.tour, source: "historical-match" };
}

/**
 * Extends the provider's own name search (current ATP/WTA standings only) with real matches
 * found in our own previously-fetched historical match records -- e.g. Challenger/ITF players who
 * have never been in a top-ranking standings snapshot but have played (and been recorded playing)
 * a real match we already imported. Never fabricates a player; every result is an exact
 * `player_key` + name the provider itself reported on some real match.
 */
export async function searchKnownPlayers(provider: TennisDataProvider, query: string): Promise<PlayerSummary[]> {
  const liveResults = await provider.searchPlayers(query);
  const seenIds = new Set(liveResults.map((p) => p.id));

  const lowerQuery = query.toLowerCase().trim();
  const likePattern = `%${lowerQuery}%`;
  const [asPlayer1Rows, asPlayer2Rows] = await Promise.all([
    db
      .select({ id: historicalMatchesTable.player1Id, name: historicalMatchesTable.player1Name, tour: historicalMatchesTable.tour })
      .from(historicalMatchesTable)
      .where(and(sql`lower(${historicalMatchesTable.player1Name}) like ${likePattern}`, sql`${historicalMatchesTable.player1Name} not like '%/%'`))
      .limit(100),
    db
      .select({ id: historicalMatchesTable.player2Id, name: historicalMatchesTable.player2Name, tour: historicalMatchesTable.tour })
      .from(historicalMatchesTable)
      .where(and(sql`lower(${historicalMatchesTable.player2Name}) like ${likePattern}`, sql`${historicalMatchesTable.player2Name} not like '%/%'`))
      .limit(100),
  ]);
  const historicalRows = [...asPlayer1Rows, ...asPlayer2Rows];

  const historicalById = new Map<string, HistoricalPlayerRow>();
  for (const row of historicalRows) {
    if (seenIds.has(row.id)) continue; // already covered by the live standings result
    const existing = historicalById.get(row.id);
    // Keep the first-seen tour for a given id -- good enough for a "last known tour" disclosure;
    // exact recency isn't worth a second query here since this is a supplementary search result.
    if (!existing) historicalById.set(row.id, row);
  }

  const historicalSummaries: PlayerSummary[] = Array.from(historicalById.values()).map((row) => ({
    id: row.id,
    name: row.name,
    countryCode: null, // not stored on historical_matches -- honestly omitted, never guessed
    currentRank: null, // no live ranking known -- this player wasn't in the standings feed
    tour: row.tour,
    source: "historical-match",
  }));

  return [...liveResults, ...historicalSummaries].slice(0, 25);
}
