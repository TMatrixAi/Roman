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
import { fetchFromSofascore } from "../parlayBuilder/sofascoreProvider.js";

// Minimum number of match records below which Sofascore tier-3 is attempted.
const SOFASCORE_MIN_RECORDS_THRESHOLD = 5;

export class CompositeTennisProvider implements TennisDataProvider {
  readonly name: string;
  /**
   * Caches player names keyed by player ID so the Sofascore tier-3 fallback in
   * getPlayerMatches can do a name-based search (Sofascore has no ID-based lookup).
   * Populated automatically on every successful getPlayer() call.
   */
  private readonly playerNameCache = new Map<string, string>();

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

  /**
   * Pre-seed the player name cache so the Sofascore tier-3 in getPlayerMatches
   * can activate even when both primary and fallback fail for getPlayer. Should
   * be called by any code that already has the player name from fixture data
   * (e.g. predictFromSnapshot when submittedPlayerName is available). Has no
   * effect if the ID is already cached from a prior getPlayer call.
   */
  seedPlayerName(playerId: string, name: string): void {
    if (!this.playerNameCache.has(playerId)) {
      this.playerNameCache.set(playerId, name);
    }
  }

  async getPlayer(playerId: string): Promise<PlayerProfile | null> {
    const profile = await this.withFallback(
      "getPlayer",
      () => this.primary.getPlayer(playerId),
      () => this.fallback.getPlayer(playerId),
    );
    // Cache name for Sofascore tier-3 in getPlayerMatches (name-based search).
    if (profile?.name) {
      this.playerNameCache.set(playerId, profile.name);
    }
    return profile;
  }

  async getPlayerMatches(playerId: string): Promise<MatchRecord[]> {
    // Match history is enrichment data — the prediction engine degrades gracefully to a
    // lower data-quality score when history is absent. If BOTH providers are unavailable
    // (MatchStat has no history endpoint; API-Tennis times out under load), return [] so
    // the prediction still runs rather than surfacing a 502 to the user.
    let records: MatchRecord[] = [];
    try {
      records = await this.withFallback(
        "getPlayerMatches",
        () => this.primary.getPlayerMatches(playerId),
        () => this.fallback.getPlayerMatches(playerId),
      );
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        logger.warn(
          { playerId, err: err.message },
          "Both providers unavailable for getPlayerMatches — attempting Sofascore tier-3 fallback",
        );
        // Fall through to Sofascore tier-3 below.
      } else {
        throw err;
      }
    }

    // Tier-3: Sofascore. Used when both primary and fallback return sparse or no history,
    // which happens most often for Challenger/ITF/WTA-lower players. Sofascore has broader
    // coverage for these tiers. Only attempted when a player name is cached (i.e. getPlayer
    // was called first, which is the normal prediction flow).
    if (records.length < SOFASCORE_MIN_RECORDS_THRESHOLD) {
      const playerName = this.playerNameCache.get(playerId);
      if (playerName) {
        try {
          const sfResult = await fetchFromSofascore(playerName);
          if (sfResult.records.length > 0) {
            logger.debug(
              { playerId, playerName, primary: records.length, sofascore: sfResult.records.length },
              "compositeProvider: Sofascore tier-3 supplemented match history",
            );
            // Merge: Sofascore records first (most recent events first), primary records appended.
            // Deduplication by (surface, score, tourney similarity) is not done here — the
            // prediction engine handles sparse/duplicate history gracefully.
            return sfResult.records.length >= records.length
              ? sfResult.records
              : records;
          }
        } catch (sfErr) {
          logger.debug({ playerId, playerName, err: sfErr }, "compositeProvider: Sofascore tier-3 failed (non-fatal)");
        }
      }
    }

    return records;
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
