import { ApiTennisProvider } from "./apiTennisProvider";
import { CompositeTennisProvider } from "./compositeProvider";
import { MatchStatProvider } from "./matchStatProvider";
import { ProviderUnavailableError, type ProviderStatusInfo, type TennisDataProvider } from "./types";

export * from "./types";

const NOT_CONFIGURED_MESSAGE =
  "API_TENNIS_KEY is not set yet. Add a real tennis data provider API key -- this app never falls back to mock data.";

/** Used until a real API key is configured. Every data method reports a clean 502, never fake data. */
class NotConfiguredProvider implements TennisDataProvider {
  readonly name = "API-Tennis";

  getStatus(): ProviderStatusInfo {
    return { provider: this.name, connected: false, lastSuccessfulCallAt: null, lastError: NOT_CONFIGURED_MESSAGE };
  }
  async searchPlayers(): Promise<never> {
    throw new ProviderUnavailableError(NOT_CONFIGURED_MESSAGE);
  }
  async getPlayer(): Promise<never> {
    throw new ProviderUnavailableError(NOT_CONFIGURED_MESSAGE);
  }
  async getPlayerMatches(): Promise<never> {
    throw new ProviderUnavailableError(NOT_CONFIGURED_MESSAGE);
  }
  async getUpcomingFixtures(): Promise<never> {
    throw new ProviderUnavailableError(NOT_CONFIGURED_MESSAGE);
  }
  async getUpcomingFixturesRange(): Promise<never> {
    throw new ProviderUnavailableError(NOT_CONFIGURED_MESSAGE);
  }
  async getHeadToHead(): Promise<never> {
    throw new ProviderUnavailableError(NOT_CONFIGURED_MESSAGE);
  }
  async getCompletedMatchesByDateRange(): Promise<never> {
    throw new ProviderUnavailableError(NOT_CONFIGURED_MESSAGE);
  }
  async getLiveScores(): Promise<never> {
    throw new ProviderUnavailableError(NOT_CONFIGURED_MESSAGE);
  }
}

let cachedProvider: TennisDataProvider | null = null;

/**
 * Factory for the active tennis data provider.
 *
 * When both API_TENNIS_KEY and X_RAPIDAPI_KEY are configured, returns a composite provider
 * that tries RapidAPI (tennis-api-atp-wta-itf.p.rapidapi.com) first and falls back to API-Tennis on any
 * error. This gives the app access to MatchStat's richer data (H2H, stats, rankings) while
 * preserving the proven API-Tennis path for anything MatchStat can't serve.
 *
 * When only API_TENNIS_KEY is set, returns the ApiTennisProvider directly (no change from
 * before this task). When neither key is set, returns NotConfiguredProvider so routes get a
 * clean 502 rather than a crash.
 */
export function getTennisDataProvider(): TennisDataProvider {
  if (cachedProvider) return cachedProvider;

  const apiTennisKey = process.env.API_TENNIS_KEY;
  // Secret was renamed from X_RAPIDAPI_KEY → x_rapidapi_key; accept both for compatibility.
  const rapidApiKey = process.env.X_RAPIDAPI_KEY ?? process.env.x_rapidapi_key;

  if (!apiTennisKey) {
    cachedProvider = new NotConfiguredProvider();
    return cachedProvider;
  }

  const apiTennisProvider = new ApiTennisProvider(apiTennisKey);

  if (rapidApiKey) {
    const matchStatProvider = new MatchStatProvider(rapidApiKey);
    cachedProvider = new CompositeTennisProvider(matchStatProvider, apiTennisProvider);
  } else {
    cachedProvider = apiTennisProvider;
  }

  return cachedProvider;
}

/**
 * Returns the raw API-Tennis provider regardless of composite configuration.
 * Used by the historical backfill pipeline, which requires API-Tennis's bulk
 * date-range endpoint that MatchStat does not provide.
 */
export function getApiTennisProvider(): ApiTennisProvider | null {
  const apiTennisKey = process.env.API_TENNIS_KEY;
  return apiTennisKey ? new ApiTennisProvider(apiTennisKey) : null;
}
