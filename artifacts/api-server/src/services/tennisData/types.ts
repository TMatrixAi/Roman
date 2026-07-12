// Provider-agnostic tennis data types. Any real data source (API-Tennis, Sportradar, ...)
// implements TennisDataProvider and returns these shapes. Nothing here is mock/sample data --
// every field is either present from the upstream API or explicitly null.

export type Surface = "Hard" | "Clay" | "Grass" | "IndoorHard";
export type MatchFormat = "BestOf3" | "BestOf5";
export type TournamentLevel =
  | "GrandSlam"
  | "Masters1000"
  | "ATP500"
  | "ATP250"
  | "WTA1000"
  | "WTA500"
  | "WTA250"
  | "Challenger"
  | "ITF"
  | "Other";

/**
 * How a player's tour/rank were resolved. "live-standings" means the current ATP/WTA standings
 * feed had them (rank/tour are live). "historical-match" means the standings feed didn't have
 * them (e.g. a Challenger/ITF-only player, or a recently-retired/returning player outside the
 * current top rankings), but a real, previously-fetched match record did -- still real data, just
 * reflecting their last known match rather than a live ranking. Omitted (undefined) when neither
 * source could resolve anything -- a genuinely unresolvable player, never silently defaulted.
 */
export type PlayerProfileSource = "live-standings" | "historical-match";

export interface PlayerSummary {
  id: string;
  name: string;
  countryCode: string | null;
  currentRank: number | null;
  tour: string | null;
  source?: PlayerProfileSource;
}

export interface PlayerProfile extends PlayerSummary {
  age: number | null;
  plays: string | null;
  /** Provider's full given+family name, when it differs from the display name. */
  fullName: string | null;
}

export interface MatchStatLine {
  firstServePct: number | null;
  firstServeWon: number | null;
  secondServeWon: number | null;
  aces: number | null;
  doubleFaults: number | null;
  breakPointsSaved: number | null;
  breakPointsFaced: number | null;
  returnPointsWon: number | null;
  /**
   * Overall percentage of total service points won in the match (0-100), when the provider
   * reports match-level point totals directly. Distinct from `firstServeWon`/`secondServeWon`,
   * which only cover points won on first/second serve individually.
   */
  servicePointsWonPct: number | null;
}

export interface MatchRecord {
  id: string;
  date: string;
  tournamentName: string | null;
  tournamentLevel: TournamentLevel | null;
  round: string | null;
  matchFormat: MatchFormat | null;
  surface: Surface | null;
  indoor: boolean | null;
  opponentId: string;
  opponentName: string;
  opponentRank: number | null;
  result: "W" | "L";
  score: string | null;
  retired: boolean;
  walkover: boolean;
  stats: MatchStatLine | null;
  opponentStats: MatchStatLine | null;
  /** Games won/lost per set, when the provider reports it. Used for serve/return proxies. */
  setGameMargins: Array<{ playerGames: number; opponentGames: number }>;
}

export interface Fixture {
  id: string;
  /** Calendar date the match is scheduled for (YYYY-MM-DD), always present. */
  date: string;
  /**
   * Full ISO-8601 instant (UTC) combining the provider's real event_date + event_time for this
   * specific fixture. Null when the provider did not supply a verified start time for this match
   * -- never fabricated or copied from another fixture/tournament. When null, `timeConfirmed` is
   * false and callers must display "Time TBD" rather than inventing a time.
   */
  scheduledStart: string | null;
  /** True only when `scheduledStart` reflects a real provider-supplied time for this exact fixture. */
  timeConfirmed: boolean;
  tournamentName: string | null;
  tournamentLevel: TournamentLevel | null;
  round: string | null;
  surface: Surface | null;
  indoor: boolean | null;
  matchFormat: MatchFormat | null;
  player1Id: string;
  player1Name: string;
  player2Id: string;
  player2Name: string;
}

export interface HeadToHeadMeeting {
  date: string;
  tournamentName: string | null;
  surface: Surface | null;
  score: string | null;
  winnerId: string;
}

export interface HeadToHeadRecord {
  player1Id: string;
  player2Id: string;
  meetings: HeadToHeadMeeting[];
}

/**
 * A single completed (or definitively-terminated: retired/walkover/cancelled) historical match,
 * as reported directly by a provider's bulk date-range endpoint. This is intentionally a richer,
 * lower-level shape than `MatchRecord` (which is player-perspective) -- the historical backfill
 * pipeline needs the neutral, tour-wide view so it can process matches in true chronological
 * order across every player at once.
 */
export interface HistoricalFixture {
  id: string;
  provider: string;
  date: string; // YYYY-MM-DD, as reported by the provider
  time: string | null; // HH:MM local-to-provider, when known
  tour: string | null;
  tournamentName: string | null;
  tournamentLevel: TournamentLevel | null;
  round: string | null;
  surface: Surface | null;
  matchFormat: MatchFormat | null;
  player1Id: string;
  player1Name: string;
  player2Id: string;
  player2Name: string;
  winnerId: string | null; // null only when cancelled
  score: string | null;
  retired: boolean;
  walkover: boolean;
  cancelled: boolean;
  /** Games won/lost per set, from player1's perspective, when the provider reports it. */
  setGameMargins: Array<{ player1Games: number; player2Games: number }>;
  /** Raw provider payload, kept for audit trails in the historical store. */
  raw: unknown;
}

export interface ProviderStatusInfo {
  provider: string;
  connected: boolean;
  lastSuccessfulCallAt: string | null;
  lastError: string | null;
}

/** Thrown when the upstream provider cannot serve a request (network error, missing key, non-2xx, etc). */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export interface TennisDataProvider {
  readonly name: string;
  searchPlayers(query: string): Promise<PlayerSummary[]>;
  getPlayer(playerId: string): Promise<PlayerProfile | null>;
  getPlayerMatches(playerId: string): Promise<MatchRecord[]>;
  getUpcomingFixtures(date: string): Promise<Fixture[]>;
  getHeadToHead(player1Id: string, player2Id: string): Promise<HeadToHeadRecord>;
  /**
   * Bulk, player-agnostic pull of every definitively-terminated match in a date range (finished,
   * retired, walkover, or cancelled). Used only by the historical backfill pipeline -- never by
   * live prediction requests. `dateStart`/`dateStop` are inclusive, `YYYY-MM-DD`.
   */
  getCompletedMatchesByDateRange(dateStart: string, dateStop: string): Promise<HistoricalFixture[]>;
  getStatus(): ProviderStatusInfo;
}
