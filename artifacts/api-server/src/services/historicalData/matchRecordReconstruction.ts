import type { HistoricalMatchRow } from "@workspace/db";
import type { HeadToHeadMeeting, HeadToHeadRecord, MatchFormat, MatchRecord, MatchStatLine, Surface, TournamentLevel } from "../tennisData/types";
import { mapStatistics, type RawMatch } from "../tennisData/apiTennisProvider";

type GameMargins = Array<{ player1Games: number; player2Games: number }>;

/**
 * In-memory index over the WHOLE historical corpus, built ONCE per walk-forward run and reused
 * for every match scored. Walk-forward scores potentially thousands of matches per run, and each
 * one needs two players' full prior histories plus their head-to-head -- querying the DB fresh
 * for each of those would mean tens of thousands of round-trips per run. Since the corpus is
 * small enough to hold entirely in memory (tens of thousands of rows), this index instead groups
 * every row by player ONCE, and `reconstructPlayerMatchHistory`/`reconstructHeadToHead` do pure
 * in-memory filtering against it -- no I/O per match.
 */
export interface MatchHistoryIndex {
  byPlayer: Map<string, HistoricalMatchRow[]>;
}

/** Builds a `MatchHistoryIndex` from every non-cancelled, determinate-result row in `rows`. */
export function buildMatchHistoryIndex(rows: HistoricalMatchRow[]): MatchHistoryIndex {
  const byPlayer = new Map<string, HistoricalMatchRow[]>();
  for (const row of rows) {
    if (row.cancelled || row.winnerId === null) continue;
    for (const playerId of [row.player1Id, row.player2Id]) {
      const list = byPlayer.get(playerId) ?? [];
      list.push(row);
      byPlayer.set(playerId, list);
    }
  }
  // Sort once per player, descending by scheduled start, so callers can just take a prefix.
  for (const list of byPlayer.values()) list.sort((a, b) => b.scheduledStartAt.getTime() - a.scheduledStartAt.getTime());
  return { byPlayer };
}

/**
 * Stats parsing (`mapStatistics`) is tied to API-Tennis's specific `statistics` payload shape --
 * the only provider implemented so far. A future second provider would need its own mapper here
 * rather than silently reusing this one; until then, a row from any other provider honestly
 * yields no stats (never a fabricated/interpolated line).
 */
function statsFor(row: HistoricalMatchRow, playerId: string): MatchStatLine | null {
  if (row.provider !== "API-Tennis") return null;
  return mapStatistics(row.rawSource as RawMatch, playerId);
}

function toMatchRecord(row: HistoricalMatchRow, playerId: string): MatchRecord {
  const isPlayer1 = row.player1Id === playerId;
  const opponentId = isPlayer1 ? row.player2Id : row.player1Id;
  const opponentName = isPlayer1 ? row.player2Name : row.player1Name;
  const margins = (row.gameMarginsPlayer1 as GameMargins | null) ?? [];
  const surface = (row.surface as Surface | null) ?? null;

  return {
    id: String(row.id),
    date: row.scheduledStartAt.toISOString(),
    tournamentName: row.tournamentName,
    tournamentLevel: (row.tournamentLevel as TournamentLevel | null) ?? null,
    round: row.round,
    matchFormat: (row.matchFormat as MatchFormat | null) ?? null,
    surface,
    indoor: surface === "IndoorHard" ? true : null,
    opponentId,
    opponentName,
    opponentRank: null,
    result: row.winnerId === playerId ? "W" : "L",
    score: row.score,
    retired: row.retired,
    walkover: row.walkover,
    stats: statsFor(row, playerId),
    opponentStats: statsFor(row, opponentId),
    setGameMargins: margins.map((m) => (isPlayer1 ? { playerGames: m.player1Games, opponentGames: m.player2Games } : { playerGames: m.player2Games, opponentGames: m.player1Games })),
  };
}

/**
 * Rebuilds a player's real match history, in the exact `MatchRecord` shape the live prediction
 * engine's modules (surfaceElo, serveReturn, recentForm, fatigue, availability, styleMatchup,
 * headToHead) already consume, using ONLY matches already frozen in Phase 3's leak-proof
 * historical store with `scheduledStartAt < beforeCutoff`. This is what lets walk-forward
 * backtesting run the exact same `runPredictionEngine` ensemble real predictions use, instead of
 * a separately-maintained reduced approximation of it.
 *
 * `beforeCutoff` should be the match being SCORED's own frozen `cutoffAt` -- the same boundary
 * the backfill pipeline already enforces when building `matchFeatureSnapshotsTable`, so a
 * backtest can never see a fact that wasn't actually knowable yet.
 */
export function reconstructPlayerMatchHistory(index: MatchHistoryIndex, playerId: string, beforeCutoff: Date): MatchRecord[] {
  const rows = index.byPlayer.get(playerId);
  if (!rows || rows.length === 0) return [];
  const cutoffMs = beforeCutoff.getTime();
  const result: MatchRecord[] = [];
  for (const row of rows) {
    if (row.scheduledStartAt.getTime() >= cutoffMs) continue; // rows are sorted descending; keep scanning, later ones may still be older matches out of a different player's list mixed in -- no, this list is single-player and sorted, but a few rows can share the exact same timestamp, so don't break early.
    result.push(toMatchRecord(row, playerId));
  }
  return result;
}

/**
 * Rebuilds real head-to-head meetings between two players from the historical store, strictly
 * before `beforeCutoff` -- same leak-proof boundary as `reconstructPlayerMatchHistory`.
 */
export function reconstructHeadToHead(index: MatchHistoryIndex, player1Id: string, player2Id: string, beforeCutoff: Date): HeadToHeadRecord {
  const rows = index.byPlayer.get(player1Id);
  const cutoffMs = beforeCutoff.getTime();
  const meetings: HeadToHeadMeeting[] = [];
  if (rows) {
    for (const row of rows) {
      if (row.scheduledStartAt.getTime() >= cutoffMs) continue;
      const isAgainstPlayer2 = row.player1Id === player2Id || row.player2Id === player2Id;
      if (!isAgainstPlayer2) continue;
      meetings.push({
        date: row.scheduledStartAt.toISOString(),
        tournamentName: row.tournamentName,
        surface: (row.surface as Surface | null) ?? null,
        score: row.score,
        winnerId: row.winnerId as string,
      });
    }
  }
  return { player1Id, player2Id, meetings };
}
