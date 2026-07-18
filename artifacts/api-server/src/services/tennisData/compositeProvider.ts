/**
 * Composite (primary + fallback) TennisDataProvider.
 *
 * Tries the primary provider (MatchStat/tennisapi1) for every request. When the primary
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
    // Report primary status; callers can also call each provider's getStatus() directly.
    return this.primary.getStatus();
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
    return this.withFallback(
      "getPlayerMatches",
      () => this.primary.getPlayerMatches(playerId),
      () => this.fallback.getPlayerMatches(playerId),
    );
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
}
