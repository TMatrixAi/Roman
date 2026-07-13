import { logger } from "../../lib/logger";
import { OddsApiIoProvider } from "./oddsApiIoProvider";
import { TheOddsApiProvider } from "./theOddsApiProvider";
import { OddsProviderUnavailableError, type OddsProvider, type OddsProviderStatusInfo, type OddsQuote } from "./types";

export * from "./types";

let primary: OddsProvider | null | undefined;
let fallback: OddsProvider | null | undefined;

function getPrimaryProvider(): OddsProvider | null {
  if (primary === undefined) {
    const apiKey = process.env.THE_ODDS_API_KEY;
    primary = apiKey ? new TheOddsApiProvider(apiKey) : null;
  }
  return primary;
}

function getFallbackProvider(): OddsProvider | null {
  if (fallback === undefined) {
    const apiKey = process.env.ODDS_API_IO_KEY;
    fallback = apiKey ? new OddsApiIoProvider(apiKey) : null;
  }
  return fallback;
}

export function getOddsProviderStatuses(): OddsProviderStatusInfo[] {
  const statuses: OddsProviderStatusInfo[] = [];
  const p = getPrimaryProvider();
  const f = getFallbackProvider();
  if (p) statuses.push(p.getStatus());
  if (f) statuses.push(f.getStatus());
  return statuses;
}

/**
 * Looks up real pre-match head-to-head odds for one matchup, trying The Odds API first and
 * automatically falling back to Odds-API.io when the primary is unavailable or has hit its
 * rate/usage limit. Returns null -- never fabricated -- when neither provider is configured, or
 * neither has real odds for this matchup. Callers must treat null as "no odds available for this
 * prediction", not as "assume 50/50" or any other synthesized value.
 */
export async function fetchMarketOdds(player1Name: string, player2Name: string, scheduledStart: Date | null): Promise<OddsQuote | null> {
  const primaryProvider = getPrimaryProvider();
  if (primaryProvider) {
    try {
      const quote = await primaryProvider.getMatchOdds(player1Name, player2Name, scheduledStart);
      if (quote) return quote;
      // Primary is up but genuinely has no odds for this matchup -- still worth checking the
      // fallback, since coverage differs by provider (different bookmaker panels/tournaments).
    } catch (err) {
      logger.warn({ err }, "The Odds API unavailable or rate-limited, falling back to Odds-API.io");
    }
  }

  const fallbackProvider = getFallbackProvider();
  if (fallbackProvider) {
    try {
      return await fallbackProvider.getMatchOdds(player1Name, player2Name, scheduledStart);
    } catch (err) {
      logger.warn({ err }, "Odds-API.io unavailable, no market odds for this matchup this cycle");
      return null;
    }
  }

  return null;
}

/** Exported for tests only -- resets the cached provider singletons between test cases. */
export function _resetOddsProvidersForTest(): void {
  primary = undefined;
  fallback = undefined;
}

export { OddsProviderUnavailableError };
