import { logger } from "../../lib/logger";
import { TtlCache } from "./cache";
import { inferSurfaceAndLevel } from "./surfaceMap";
import {
  ProviderUnavailableError,
  type Fixture,
  type HeadToHeadRecord,
  type HistoricalFixture,
  type MatchFormat,
  type MatchRecord,
  type PlayerProfile,
  type PlayerSummary,
  type ProviderStatusInfo,
  type TennisDataProvider,
} from "./types";

const BASE_URL = "https://api.api-tennis.com/tennis/";
const STANDINGS_TTL_MS = 30 * 60 * 1000; // 30 minutes
const FIXTURES_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ApiTennisEnvelope<T> {
  success: 0 | 1;
  result: T;
}

/** API-Tennis is inconsistent about whether keys come back as strings or numbers -- always normalize with str(). */
function str(value: string | number): string {
  return String(value);
}

interface RawStandingRow {
  place: string;
  player: string;
  player_key: string | number;
  league: string;
  country: string;
  points: string;
}

interface RawPlayer {
  player_key: string | number;
  player_name: string;
  player_country: string | null;
  player_bday: string | null;
}

interface RawScoreEntry {
  score_first: string;
  score_second: string;
  score_set: string;
}

interface RawMatch {
  event_key: string | number;
  event_date: string;
  event_time?: string;
  event_first_player: string;
  first_player_key: string | number;
  event_second_player: string;
  second_player_key: string | number;
  event_final_result: string;
  event_winner: "First Player" | "Second Player" | null;
  event_status: string;
  event_type_type?: string;
  tournament_name: string;
  tournament_key?: string;
  tournament_round?: string;
  scores?: RawScoreEntry[];
}

function determineMatchFormat(eventTypeType: string | undefined, level: string | null): MatchFormat {
  const type = eventTypeType ?? "";
  const isDoubles = /doubles/i.test(type);
  const isMen = /atp|men/i.test(type);
  // Best-of-5 only applies to men's singles at Grand Slams -- doubles (at any level, including
  // slams) and all WTA/junior/challenger matches are best-of-3.
  if (isMen && !isDoubles && level === "GrandSlam") return "BestOf5";
  return "BestOf3";
}

function parseAgeFromBday(bday: string | null): number | null {
  if (!bday) return null;
  const parts = bday.split(".");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts.map((p) => parseInt(p, 10));
  if (!dd || !mm || !yyyy) return null;
  const born = new Date(yyyy, mm - 1, dd);
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() >= born.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

function mapMatchStatus(status: string): { retired: boolean; walkover: boolean; finished: boolean } {
  const lower = status.toLowerCase();
  return {
    retired: lower.includes("retired"),
    walkover: lower.includes("walkover") || lower.includes("w.o"),
    finished: lower === "finished" || lower.includes("retired") || lower.includes("walkover"),
  };
}

/**
 * API-Tennis reports tiebreak sets as decimals (e.g. "7.7"-"6.5" for a 7-6(5) set) instead of
 * documenting the tiebreak points separately. We don't have a reliable way to tell which side of
 * the decimal is the tiebreak-loser's points without more provider documentation, so we round to
 * the game count only -- an honest "7-6" beats a confusing "7.7-6.5". Deferred: reconstruct full
 * tiebreak scores (e.g. "7-6(5)") once the provider's exact encoding is confirmed.
 */
function mapScoreString(raw: RawMatch): string | null {
  if (raw.scores && raw.scores.length > 0) {
    return raw.scores
      .map((s) => {
        // Truncate (not round) to the whole-games part: "7.7" is 7 games (plus a tiebreak
        // point count we discard), and Math.round would wrongly bump it to 8.
        const first = Math.trunc(parseFloat(s.score_first));
        const second = Math.trunc(parseFloat(s.score_second));
        if (Number.isNaN(first) || Number.isNaN(second)) return `${s.score_first}-${s.score_second}`;
        return `${first}-${second}`;
      })
      .join(" ");
  }
  return raw.event_final_result ?? null;
}

/** Normalizes API-Tennis's free-text `event_type_type` into a coarse, stable tour label. */
function deriveTour(eventTypeType: string | undefined): string | null {
  const type = eventTypeType ?? "";
  if (!type) return null;
  if (/challenger/i.test(type)) return "Challenger";
  if (/itf/i.test(type)) return "ITF";
  if (/exhibition/i.test(type)) return "Exhibition";
  if (/boys|girls|junior/i.test(type)) return "Junior";
  if (/atp/i.test(type)) return "ATP";
  if (/wta/i.test(type)) return "WTA";
  return type;
}

function mapHistoricalFixtureGameMargins(raw: RawMatch): Array<{ player1Games: number; player2Games: number }> {
  if (!raw.scores) return [];
  return raw.scores
    .map((s) => {
      const first = Math.trunc(parseFloat(s.score_first));
      const second = Math.trunc(parseFloat(s.score_second));
      if (Number.isNaN(first) || Number.isNaN(second)) return null;
      return { player1Games: first, player2Games: second };
    })
    .filter((v): v is { player1Games: number; player2Games: number } => v !== null);
}

function mapSetGameMargins(raw: RawMatch, isFirstPlayer: boolean): Array<{ playerGames: number; opponentGames: number }> {
  if (!raw.scores) return [];
  return raw.scores
    .map((s) => {
      const first = parseInt(s.score_first, 10);
      const second = parseInt(s.score_second, 10);
      if (Number.isNaN(first) || Number.isNaN(second)) return null;
      return isFirstPlayer ? { playerGames: first, opponentGames: second } : { playerGames: second, opponentGames: first };
    })
    .filter((v): v is { playerGames: number; opponentGames: number } => v !== null);
}

export class ApiTennisProvider implements TennisDataProvider {
  readonly name = "API-Tennis";

  private apiKey: string;
  private cache = new TtlCache();
  private lastSuccessfulCallAt: string | null = null;
  private lastError: string | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  getStatus(): ProviderStatusInfo {
    return {
      provider: this.name,
      connected: this.lastSuccessfulCallAt !== null,
      lastSuccessfulCallAt: this.lastSuccessfulCallAt,
      lastError: this.lastError,
    };
  }

  private async call<T>(method: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(BASE_URL);
    url.searchParams.set("method", method);
    url.searchParams.set("APIkey", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    try {
      const response = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        throw new Error(`API-Tennis responded with HTTP ${response.status}`);
      }
      const body = (await response.json()) as ApiTennisEnvelope<T>;
      if (body.success !== 1) {
        throw new Error("API-Tennis reported an unsuccessful response");
      }
      this.lastSuccessfulCallAt = new Date().toISOString();
      this.lastError = null;
      return body.result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error calling API-Tennis";
      this.lastError = message;
      logger.error({ err, method }, "API-Tennis call failed");
      throw new ProviderUnavailableError(message);
    }
  }

  private async getStandingsCache(): Promise<RawStandingRow[]> {
    return this.cache.getOrFetch("standings", STANDINGS_TTL_MS, async () => {
      const [atp, wta] = await Promise.all([
        this.call<RawStandingRow[]>("get_standings", { event_type: "ATP" }),
        this.call<RawStandingRow[]>("get_standings", { event_type: "WTA" }),
      ]);
      return [...(atp ?? []), ...(wta ?? [])];
    });
  }

  /**
   * Player search is scoped to players who currently appear in the ATP/WTA standings feed.
   * API-Tennis has no name-search endpoint (`get_players` requires an exact `player_key`,
   * confirmed live: passing `player_name` returns a "Required parameter missing: player_key"
   * error, not a search). That means retired players, players outside the current
   * ATP/WTA rankings (e.g. Challenger/ITF-only players), and very recently-retired top
   * players are genuinely unsearchable with this provider -- not a bug in this function,
   * a hard provider limitation. Callers must not interpret an empty result as "player
   * doesn't exist"; it means "not in the current ATP/WTA standings snapshot".
   *
   * Within that scope we still make ranking honest and deterministic:
   * - de-duplicate by player_key (defensive: a player briefly overlapping both tour lists,
   *   or any future provider quirk, should not produce duplicate rows)
   * - rank exact (case-insensitive) full-name matches above partial/substring matches
   * - break ties by current rank ascending (unranked/parse failures sort last)
   * so the most relevant, most recognizable player for a query is never buried by
   * whichever tour's list happened to come first in the combined standings array.
   */
  async searchPlayers(query: string): Promise<PlayerSummary[]> {
    const standings = await this.getStandingsCache();
    const lowerQuery = query.toLowerCase().trim();

    const seen = new Set<string>();
    const matches: Array<{ row: RawStandingRow; rank: number | null; exact: boolean }> = [];
    for (const row of standings) {
      const key = str(row.player_key);
      if (seen.has(key)) continue;
      const lowerName = row.player.toLowerCase();
      if (!lowerName.includes(lowerQuery)) continue;
      seen.add(key);
      const rank = parseInt(row.place, 10);
      matches.push({ row, rank: Number.isNaN(rank) ? null : rank, exact: lowerName === lowerQuery });
    }

    matches.sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      if (a.rank === null && b.rank === null) return 0;
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      return a.rank - b.rank;
    });

    return matches.slice(0, 25).map(({ row }) => ({
      id: str(row.player_key),
      name: row.player,
      countryCode: row.country ?? null,
      currentRank: parseInt(row.place, 10) || null,
      tour: row.league ?? null,
    }));
  }

  async getPlayer(playerId: string): Promise<PlayerProfile | null> {
    const [players, standings] = await Promise.all([
      this.call<RawPlayer[]>("get_players", { player_key: playerId }),
      this.getStandingsCache(),
    ]);
    const raw = players?.[0];
    if (!raw) return null;
    const standingRow = standings.find((row) => str(row.player_key) === playerId);
    return {
      id: str(raw.player_key),
      name: raw.player_name,
      countryCode: raw.player_country ?? standingRow?.country ?? null,
      currentRank: standingRow ? parseInt(standingRow.place, 10) || null : null,
      tour: standingRow?.league ?? null,
      age: parseAgeFromBday(raw.player_bday),
      plays: null,
    };
  }

  async getPlayerMatches(playerId: string): Promise<MatchRecord[]> {
    const dateStop = new Date();
    const dateStart = new Date(dateStop.getTime() - 365 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const raw = await this.cache.getOrFetch(`matches:${playerId}`, FIXTURES_TTL_MS, () =>
      this.call<RawMatch[]>("get_fixtures", {
        player_key: playerId,
        date_start: fmt(dateStart),
        date_stop: fmt(dateStop),
      }),
    );

    return (raw ?? [])
      .filter((m) => mapMatchStatus(m.event_status).finished && m.event_winner !== null)
      .map((m) => this.mapMatchRecord(m, playerId))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  private mapMatchRecord(raw: RawMatch, playerId: string): MatchRecord {
    const isFirstPlayer = str(raw.first_player_key) === playerId;
    const { surface, level } = inferSurfaceAndLevel(raw.tournament_name);
    const status = mapMatchStatus(raw.event_status);
    const won = (isFirstPlayer && raw.event_winner === "First Player") || (!isFirstPlayer && raw.event_winner === "Second Player");

    return {
      id: str(raw.event_key),
      date: raw.event_date,
      tournamentName: raw.tournament_name ?? null,
      tournamentLevel: level,
      round: raw.tournament_round ?? null,
      matchFormat: determineMatchFormat(raw.event_type_type, level),
      surface,
      indoor: surface === "IndoorHard" ? true : null,
      opponentId: isFirstPlayer ? str(raw.second_player_key) : str(raw.first_player_key),
      opponentName: isFirstPlayer ? raw.event_second_player : raw.event_first_player,
      opponentRank: null,
      result: won ? "W" : "L",
      score: mapScoreString(raw),
      retired: status.retired,
      walkover: status.walkover,
      stats: null,
      opponentStats: null,
      setGameMargins: mapSetGameMargins(raw, isFirstPlayer),
    };
  }

  async getUpcomingFixtures(date: string): Promise<Fixture[]> {
    const raw = await this.cache.getOrFetch(`fixtures:${date}`, FIXTURES_TTL_MS, () =>
      this.call<RawMatch[]>("get_fixtures", { date_start: date, date_stop: date }),
    );

    return (raw ?? [])
      .filter((m) => m.event_winner === null)
      .map((m) => {
        const { surface, level } = inferSurfaceAndLevel(m.tournament_name);
        return {
          id: str(m.event_key),
          date: m.event_date,
          tournamentName: m.tournament_name ?? null,
          tournamentLevel: level,
          round: m.tournament_round ?? null,
          surface,
          indoor: surface === "IndoorHard" ? true : null,
          matchFormat: determineMatchFormat(m.event_type_type, level),
          player1Id: str(m.first_player_key),
          player1Name: m.event_first_player,
          player2Id: str(m.second_player_key),
          player2Name: m.event_second_player,
        };
      });
  }

  /**
   * Bulk date-range pull for the historical backfill pipeline. Confirmed live (2026-07-11):
   * `get_fixtures` accepts a plain `date_start`/`date_stop` window with no `player_key`, and
   * returns every match across all tours/levels in that window (real data verified back to at
   * least 2010; ranges of ~3 weeks return successfully, but very large ranges (~1 month+) have
   * been observed to fail/time out, so callers should chunk into short windows).
   */
  async getCompletedMatchesByDateRange(dateStart: string, dateStop: string): Promise<HistoricalFixture[]> {
    const raw = await this.call<RawMatch[]>("get_fixtures", { date_start: dateStart, date_stop: dateStop });

    return (raw ?? [])
      .map((m) => {
        const status = mapMatchStatus(m.event_status);
        const isCancelled = /cancel|postpone/i.test(m.event_status);
        // Only keep matches with a definitive terminal outcome -- exclude anything still
        // scheduled/live, which should not appear in a past date range but is guarded anyway.
        if (!status.finished && !isCancelled) return null;

        const { surface, level } = inferSurfaceAndLevel(m.tournament_name);
        const winnerId =
          m.event_winner === "First Player"
            ? str(m.first_player_key)
            : m.event_winner === "Second Player"
              ? str(m.second_player_key)
              : null;

        const fixture: HistoricalFixture = {
          id: str(m.event_key),
          provider: this.name,
          date: m.event_date,
          time: m.event_time ?? null,
          tour: deriveTour(m.event_type_type),
          tournamentName: m.tournament_name ?? null,
          tournamentLevel: level,
          round: m.tournament_round ?? null,
          surface,
          matchFormat: determineMatchFormat(m.event_type_type, level),
          player1Id: str(m.first_player_key),
          player1Name: m.event_first_player,
          player2Id: str(m.second_player_key),
          player2Name: m.event_second_player,
          winnerId,
          score: mapScoreString(m),
          retired: status.retired,
          walkover: status.walkover,
          cancelled: isCancelled,
          setGameMargins: mapHistoricalFixtureGameMargins(m),
          raw: m,
        };
        return fixture;
      })
      .filter((f): f is HistoricalFixture => f !== null);
  }

  async getHeadToHead(player1Id: string, player2Id: string): Promise<HeadToHeadRecord> {
    const raw = await this.cache.getOrFetch(`h2h:${player1Id}:${player2Id}`, FIXTURES_TTL_MS, () =>
      this.call<{ H2H: RawMatch[] }>("get_H2H", {
        first_player_key: player1Id,
        second_player_key: player2Id,
      }),
    );

    const meetings = (raw?.H2H ?? [])
      .filter((m) => mapMatchStatus(m.event_status).finished && m.event_winner !== null)
      .map((m) => {
        const { surface } = inferSurfaceAndLevel(m.tournament_name);
        const winnerId = m.event_winner === "First Player" ? str(m.first_player_key) : str(m.second_player_key);
        return {
          date: m.event_date,
          tournamentName: m.tournament_name ?? null,
          surface,
          score: mapScoreString(m),
          winnerId,
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    return { player1Id, player2Id, meetings };
  }
}
