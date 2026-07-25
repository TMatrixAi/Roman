/**
 * Composite (primary + fallback) TennisDataProvider.
 *
 * Tries the primary provider (RapidAPI/tennis-api-atp-wta-itf) for every request. When the primary
 * throws ProviderUnavailableError — which covers rate limits, network errors, subscription
 * mismatches, and any HTTP error — the fallback (API-Tennis) is tried instead.
 *
 * This keeps the rest of the app completely unaware of which physical provider served the
 * data; every caller just calls `getTennisDataProvider()` and gets the best available source.
 */
import { logger } from "../../lib/logger";
import type {
  Fixture,
  HeadToHeadRecord,
  HistoricalFixture,
  LiveScore,
  MatchRecord,
  PlayerProfile,
  PlayerSummary,
  ProviderStatusInfo,
  TennisDataProvider,
} from "./types";
import { ProviderUnavailableError } from "./types";

export class CompositeTennisProvider implements TennisDataProvider {
  readonly name: string;

  constructor(
    private readonly primary: TennisDataProvider,
    private readonly fallback: TennisDataProvider,
  ) {
    this.name = `${primary.name}+${fallback.name}`;
  }

  private async withFallback<T>(
    methodName: string,
    primaryCall: () => Promise<T>,
    fallbackCall: () => Promise<T>,
  ): Promise<T> {
    try {
      return await primaryCall();
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        logger.warn({ method: methodName, primaryError: err.message }, `${this.primary.name} unavailable — falling back to ${this.fallback.name}`);
        return fallbackCall();
      }
      throw err;
    }
  }

  getStatus(): ProviderStatusInfo {
    // When the primary is connected, report it. When it isn't (rate-limited, quota exhausted,
    // network error) report the fallback instead — that's the provider actually serving requests,
    // and showing the primary's "disconnected" state while the app is perfectly functional causes
    // a misleading offline badge in the UI.
    const primaryStatus = this.primary.getStatus();
    if (primaryStatus.connected) return primaryStatus;
    const fallbackStatus = this.fallback.getStatus();
    if (fallbackStatus.connected) return fallbackStatus;
    // Both down: return primary so the error message is as specific as possible.
    return primaryStatus;
  }

  async searchPlayers(query: string): Promise<PlayerSummary[]> {
    return this.withFallback(
      "searchPlayers",
      () => this.primary.searchPlayers(query),
      () => this.fallback.searchPlayers(query),
    );
  }

  async getPlayer(playerId: string): Promise<PlayerProfile | null> {
    return this.withFallback(
      "getPlayer",
      () => this.primary.getPlayer(playerId),
      () => this.fallback.getPlayer(playerId),
    );
  }

  async getPlayerMatches(playerId: string): Promise<MatchRecord[]> {
    // Match history is enrichment data — the prediction engine degrades gracefully to a
    // lower data-quality score when history is absent. If BOTH providers are unavailable
    // (MatchStat has no history endpoint; API-Tennis times out under load), return [] so
    // the prediction still runs rather than surfacing a 502 to the user.
    try {
      return await this.withFallback(
        "getPlayerMatches",
        () => this.primary.getPlayerMatches(playerId),
        () => this.fallback.getPlayerMatches(playerId),
      );
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        logger.warn(
          { playerId, err: err.message },
          "Both providers unavailable for getPlayerMatches — returning empty match history; prediction will proceed with lower data quality",
        );
        return [];
      }
      throw err;
    }
  }

  async getUpcomingFixtures(date: string): Promise<Fixture[]> {
    return this.withFallback(
      "getUpcomingFixtures",
      () => this.primary.getUpcomingFixtures(date),
      () => this.fallback.getUpcomingFixtures(date),
    );
  }

  async getUpcomingFixturesRange(dateStart: string, dateStop: string, opts?: { bypassCache?: boolean }): Promise<Fixture[]> {
    return this.withFallback(
      "getUpcomingFixturesRange",
      () => this.primary.getUpcomingFixturesRange(dateStart, dateStop, opts),
      () => this.fallback.getUpcomingFixturesRange(dateStart, dateStop, opts),
    );
  }

  async getHeadToHead(player1Id: string, player2Id: string): Promise<HeadToHeadRecord> {
    return this.withFallback(
      "getHeadToHead",
      () => this.primary.getHeadToHead(player1Id, player2Id),
      () => this.fallback.getHeadToHead(player1Id, player2Id),
    );
  }

  async getCompletedMatchesByDateRange(dateStart: string, dateStop: string): Promise<HistoricalFixture[]> {
    // Historical backfill uses API-Tennis exclusively — MatchStat doesn't support this endpoint.
    return this.fallback.getCompletedMatchesByDateRange(dateStart, dateStop);
  }

  async getLiveScores(fixtureIds: string[]): Promise<Map<string, LiveScore>> {
    // MatchStat (primary) does not provide live scores — hard-route to API-Tennis so real
    // in-progress score data is never silently replaced with an empty map. Same pattern
    // as getCompletedMatchesByDateRange, which MatchStat also doesn't support.
    return this.fallback.getLiveScores(fixtureIds);
  }

  async findTournamentSurfaceByName(name: string): Promise<{ surface: import("./types").Surface | null; level: import("./types").TournamentLevel | null } | null> {
    // Only API-Tennis has the tournament-surface-by-name lookup; delegate directly.
    if (this.fallback.findTournamentSurfaceByName) {
      return this.fallback.findTournamentSurfaceByName(name);
    }
    return null;
  }

  /**
   * Live standings come exclusively from API-Tennis (the fallback). The MatchStat primary does
   * not implement this method, so — like `getLiveScores` and `getCompletedMatchesByDateRange` —
   * we route directly to the provider that can actually serve the data. If the fallback also
   * doesn't implement it (e.g. a test stub), we return an empty array rather than throwing,
   * which is consistent with the `runRankingVerification` guard that already handles the
   * `totalProviderRankings: 0` sentinel.
   */
  async getCurrentStandings(): Promise<Array<{ playerKey: string; rank: number; name: string; tour: "ATP" | "WTA" }>> {
    if (!this.fallback.getCurrentStandings) {
      logger.warn({ provider: this.name }, "Neither primary nor fallback implements getCurrentStandings — ranking verification will be skipped");
      return [];
    }
    return this.fallback.getCurrentStandings();
  }
}
