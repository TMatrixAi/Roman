// Provider-agnostic pre-match odds types. Mirrors the tennisData provider pattern: any real
// odds source (The Odds API, Odds-API.io, ...) implements OddsProvider and returns these shapes.
// Nothing here is mock/sample data -- a matchup with no real odds available returns null, never a
// fabricated or approximated quote.

/**
 * A single real head-to-head quote for one specific matchup, oriented to the two players passed
 * into `getMatchOdds` (never to whichever side the provider happened to list as "home"/"away").
 * Decimal odds only (e.g. 1.85), consistent across providers regardless of the upstream format.
 */
export interface OddsQuote {
  provider: string;
  player1DecimalOdds: number;
  player2DecimalOdds: number;
  /** When this quote was actually fetched (not the match's scheduled start). */
  fetchedAt: string;
}

export interface OddsProviderStatusInfo {
  provider: string;
  connected: boolean;
  lastSuccessfulCallAt: string | null;
  lastError: string | null;
}

/** Thrown when an odds provider cannot serve a request (network error, missing key, non-2xx, etc). */
export class OddsProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OddsProviderUnavailableError";
  }
}

/**
 * Thrown specifically when the provider reports its rate/usage limit has been hit (HTTP 401/429
 * for most odds APIs, or an explicit quota-exceeded error body). This is the signal `fetchMarketOdds`
 * uses to switch to the fallback provider -- a generic `OddsProviderUnavailableError` (network
 * blip, 5xx, timeout) is also treated as a fallback trigger, but this subtype exists so the
 * distinction is visible in logs/status.
 */
export class OddsProviderRateLimitedError extends OddsProviderUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = "OddsProviderRateLimitedError";
  }
}

export interface OddsProvider {
  readonly name: string;
  /**
   * Looks up real pre-match head-to-head odds for one specific matchup, matched by player name
   * (and, when `scheduledStart` is known, how close the provider's own event time is to it, to
   * avoid matching the wrong tournament/leg between the same two players). Returns null when this
   * provider's current event list has no matching matchup -- never a fabricated or approximated
   * quote for a different match.
   */
  getMatchOdds(player1Name: string, player2Name: string, scheduledStart: Date | null): Promise<OddsQuote | null>;
  getStatus(): OddsProviderStatusInfo;
}
