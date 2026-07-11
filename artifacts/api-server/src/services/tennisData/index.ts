import { ApiTennisProvider } from "./apiTennisProvider";
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
  async getHeadToHead(): Promise<never> {
    throw new ProviderUnavailableError(NOT_CONFIGURED_MESSAGE);
  }
  async getCompletedMatchesByDateRange(): Promise<never> {
    throw new ProviderUnavailableError(NOT_CONFIGURED_MESSAGE);
  }
}

let cachedProvider: TennisDataProvider | null = null;

/**
 * Factory for the active tennis data provider. Swapping providers (e.g. to Sportradar) means
 * adding a new class that implements TennisDataProvider and returning it here -- nothing else
 * in the app depends on API-Tennis directly.
 */
export function getTennisDataProvider(): TennisDataProvider {
  if (cachedProvider) return cachedProvider;

  const apiKey = process.env.API_TENNIS_KEY;
  cachedProvider = apiKey ? new ApiTennisProvider(apiKey) : new NotConfiguredProvider();
  return cachedProvider;
}
