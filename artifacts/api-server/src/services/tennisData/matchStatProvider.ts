/**
 * RapidAPI tennis provider.
 *
 * Host is read at startup from the RAPIDAPI_HOST environment variable so it can be
 * changed without a code deploy. Set RAPIDAPI_HOST to the x-rapidapi-host value shown
 * in the RapidAPI dashboard for your subscribed API (e.g. tennis-api-atp-wta-itf.p.rapidapi.com).
 *
 * All responses are cached with conservative TTLs to stay within the API's rate limits.
 * Every method falls back cleanly (throws ProviderUnavailableError) so the composite
 * provider can try the next source rather than crashing the request.
 */
import { logger } from "../../lib/logger";
import { TtlCache } from "./cache";
import { normalizeProviderSurface } from "./surfaceMap";
import type {
  Fixture,
  HeadToHeadRecord,
  HistoricalFixture,
  LiveScore,
  MatchRecord,
  PlayerProfile,
  PlayerSummary,
  ProviderStatusInfo,
  Surface,
  TennisDataProvider,
  TournamentLevel,
} from "./types";
import { ProviderUnavailableError } from "./types";

// Read host from env so it can be changed without a code deploy.
const HOST = process.env.RAPIDAPI_HOST ?? "tennis-api-atp-wta-itf.p.rapidapi.com";
const BASE_URL = `https://${HOST}`;

// Conservative TTLs — this API is rate-limited; generous caching avoids hitting limits.
const RANKINGS_TTL_MS = 60 * 60 * 1000; // 1 hour
const PLAYER_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SCHEDULE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const H2H_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RESULTS_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Retry config for 429 responses
const MAX_429_RETRIES = 3;
const BASE_BACKOFF_MS = 5_000; // 5 s base, doubles each retry

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Raw response shapes ────────────────────────────────────────────────────

interface RawRankingEntry {
  ranking?: number;
  rowName?: string;
  player?: {
    id?: number | string;
    name?: string;
    shortName?: string;
    country?: { alpha3?: string; alpha2?: string };
  };
  points?: number;
  previousRanking?: number;
}

interface RawRankingsResponse {
  rankings?: RawRankingEntry[];
  [key: string]: unknown;
}

interface RawPlayerResponse {
  player?: {
    id?: number | string;
    name?: string;
    shortName?: string;
    nationality?: { alpha3?: string; alpha2?: string };
    dateOfBirthTimestamp?: number;
    gender?: string;
    ranking?: number;
  };
  [key: string]: unknown;
}

interface RawEventPlayer {
  id?: number | string;
  name?: string;
  shortName?: string;
  country?: { alpha3?: string; alpha2?: string };
}

interface RawEvent {
  id?: number | string;
  slug?: string;
  startTimestamp?: number;
  homeTeam?: RawEventPlayer;
  awayTeam?: RawEventPlayer;
  homeScore?: { current?: number; display?: number };
  awayScore?: { current?: number; display?: number };
  status?: { type?: string; description?: string };
  tournament?: {
    name?: string;
    slug?: string;
    category?: { name?: string; slug?: string };
    uniqueTournament?: { name?: string; groundType?: string };
  };
  roundInfo?: { round?: number; name?: string };
  winnerCode?: number; // 1 = home, 2 = away
}

interface RawScheduleResponse {
  events?: RawEvent[];
  [key: string]: unknown;
}

interface RawResultsResponse {
  events?: RawEvent[];
  [key: string]: unknown;
}

interface RawH2HResponse {
  teamDuel?: {
    homeTeamWins?: number;
    awayTeamWins?: number;
  };
  events?: RawEvent[];
  [key: string]: unknown;
}

// ─── Mapping helpers ────────────────────────────────────────────────────────

function str(v: string | number | undefined | null): string {
  return v === undefined || v === null ? "" : String(v);
}

function mapSurface(groundType: string | undefined | null): Surface | null {
  if (!groundType) return null;
  return normalizeProviderSurface(groundType);
}

function mapLevel(categoryName: string | undefined | null): TournamentLevel | null {
  if (!categoryName) return null;
  const n = categoryName.toLowerCase();
  if (n.includes("grand slam")) return "GrandSlam";
  if (n.includes("atp 1000") || n.includes("masters 1000")) return "Masters1000";
  if (n.includes("atp 500")) return "ATP500";
  if (n.includes("atp 250")) return "ATP250";
  if (n.includes("wta 1000")) return "WTA1000";
  if (n.includes("wta 500")) return "WTA500";
  if (n.includes("wta 250")) return "WTA250";
  if (n.includes("challenger")) return "Challenger";
  if (n.includes("itf")) return "ITF";
  return "Other";
}

function mapEventToFixture(ev: RawEvent): Fixture | null {
  const p1 = ev.homeTeam;
  const p2 = ev.awayTeam;
  if (!p1?.id || !p2?.id) return null;

  const scheduledStart = ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : null;
  const statusType = ev.status?.type ?? "";
  const isLive = statusType === "inprogress";
  const isFinished = statusType === "finished";
  if (isFinished) return null; // Only return upcoming/live fixtures

  const tournament = ev.tournament;
  const surface = mapSurface(tournament?.uniqueTournament?.groundType);
  const level = mapLevel(tournament?.category?.name ?? tournament?.name);

  return {
    id: str(ev.id),
    date: scheduledStart ? scheduledStart.slice(0, 10) : new Date().toISOString().slice(0, 10),
    scheduledStart,
    timeConfirmed: !!scheduledStart,
    isLive,
    tournamentName: tournament?.uniqueTournament?.name ?? tournament?.name ?? null,
    tournamentLevel: level,
    round: ev.roundInfo?.name ?? (ev.roundInfo?.round != null ? `Round ${ev.roundInfo.round}` : null),
    surface,
    indoor: surface === "IndoorHard" ? true : null,
    matchFormat: null, // not provided by schedule endpoint
    player1Id: str(p1.id),
    player1Name: p1.name ?? p1.shortName ?? str(p1.id),
    player2Id: str(p2.id),
    player2Name: p2.name ?? p2.shortName ?? str(p2.id),
  };
}

function mapEventToMatchRecord(ev: RawEvent, perspectivePlayerId: string): MatchRecord | null {
  const p1 = ev.homeTeam;
  const p2 = ev.awayTeam;
  if (!p1?.id || !p2?.id) return null;

  const isP1 = str(p1.id) === perspectivePlayerId;
  const opponent = isP1 ? p2 : p1;
  const winnerCode = ev.winnerCode;
  const won = winnerCode === (isP1 ? 1 : 2);

  const scheduledStart = ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : null;
  const date = scheduledStart ? scheduledStart.slice(0, 10) : "";
  if (!date) return null;

  const tournament = ev.tournament;
  const surface = mapSurface(tournament?.uniqueTournament?.groundType);
  const level = mapLevel(tournament?.category?.name ?? tournament?.name);

  return {
    id: str(ev.id),
    date,
    tournamentName: tournament?.uniqueTournament?.name ?? tournament?.name ?? null,
    tournamentLevel: level,
    round: ev.roundInfo?.name ?? null,
    matchFormat: null,
    surface,
    indoor: surface === "IndoorHard" ? true : null,
    opponentId: str(opponent.id),
    opponentName: opponent.name ?? opponent.shortName ?? str(opponent.id),
    opponentRank: null,
    result: won ? "W" : "L",
    score: null,
    retired: false,
    walkover: false,
    stats: null,
    opponentStats: null,
    setGameMargins: [],
  };
}

// ─── Provider class ─────────────────────────────────────────────────────────

export class MatchStatProvider implements TennisDataProvider {
  readonly name = "MatchStat";

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

  private async call<T>(path: string): Promise<T> {
    const url = `${BASE_URL}${path}`;

    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            "x-rapidapi-key": this.apiKey,
            "x-rapidapi-host": HOST,
          },
          signal: AbortSignal.timeout(12_000),
        });

        if (response.status === 429) {
          // Honour Retry-After if present; otherwise use exponential backoff.
          const retryAfterSec = Number(response.headers.get("retry-after") ?? "0");
          const waitMs = retryAfterSec > 0
            ? retryAfterSec * 1_000
            : BASE_BACKOFF_MS * Math.pow(2, attempt);

          if (attempt < MAX_429_RETRIES) {
            logger.warn({ path, attempt, waitMs }, "RapidAPI 429 — backing off before retry");
            await sleep(waitMs);
            continue;
          }
          // Exhausted retries — let composite provider fall back.
          throw new ProviderUnavailableError(
            `RapidAPI rate limit exceeded after ${MAX_429_RETRIES} retries: ${path}`,
          );
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new ProviderUnavailableError(
            `MatchStat API responded with HTTP ${response.status}: ${body.slice(0, 200)}`,
          );
        }

        const body = (await response.json()) as Record<string, unknown>;
        // RapidAPI subscription/routing errors sometimes come back as HTTP 200 with {message: "..."}
        if (typeof body.message === "string") {
          throw new ProviderUnavailableError(`MatchStat API: ${body.message}`);
        }

        this.lastSuccessfulCallAt = new Date().toISOString();
        this.lastError = null;
        return body as T;

      } catch (err) {
        if (err instanceof ProviderUnavailableError) {
          this.lastError = err.message;
          throw err;
        }
        const message = err instanceof Error ? err.message : "Unknown error calling MatchStat";
        this.lastError = message;
        logger.error({ err, path }, "MatchStat API call failed");
        throw new ProviderUnavailableError(message);
      }
    }

    // TypeScript exhaustiveness — loop always returns or throws above.
    throw new ProviderUnavailableError(`MatchStat call failed: ${path}`);
  }

  // ── Rankings ────────────────────────────────────────────────────────────

  private async getRankingsForTour(tour: "atp" | "wta"): Promise<RawRankingEntry[]> {
    const key = `rankings:${tour}`;
    return this.cache.getOrFetch(key, RANKINGS_TTL_MS, async () => {
      const data = await this.call<RawRankingsResponse>(`/api/tennis/rankings/${tour}`);
      return data.rankings ?? [];
    });
  }

  async searchPlayers(query: string): Promise<PlayerSummary[]> {
    // Let ProviderUnavailableError propagate — composite provider needs it to trigger fallback.
    const [atpRows, wtaRows] = await Promise.all([
      this.getRankingsForTour("atp"),
      this.getRankingsForTour("wta"),
    ]);
    const all = [...atpRows, ...wtaRows];
    const lowerQuery = query.toLowerCase().trim();

    const seen = new Set<string>();
    const results: PlayerSummary[] = [];

    for (const row of all) {
      const player = row.player;
      if (!player?.id) continue;
      const id = str(player.id);
      if (seen.has(id)) continue;
      const name = player.name ?? player.shortName ?? "";
      if (!name.toLowerCase().includes(lowerQuery)) continue;
      seen.add(id);
      results.push({
        id,
        name,
        countryCode: player.country?.alpha2 ?? player.country?.alpha3 ?? null,
        currentRank: typeof row.ranking === "number" ? row.ranking : null,
        tour: null, // callers resolve this from the roster context
      });
    }

    // Exact-name matches first, then by rank
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === lowerQuery;
      const bExact = b.name.toLowerCase() === lowerQuery;
      if (aExact !== bExact) return aExact ? -1 : 1;
      if (a.currentRank === null && b.currentRank === null) return 0;
      if (a.currentRank === null) return 1;
      if (b.currentRank === null) return -1;
      return a.currentRank - b.currentRank;
    });

    return results.slice(0, 25);
  }

  async getPlayer(playerId: string): Promise<PlayerProfile | null> {
    const key = `player:${playerId}`;
    return this.cache.getOrFetch(key, PLAYER_TTL_MS, async () => {
      try {
        const data = await this.call<RawPlayerResponse>(`/api/tennis/player/${playerId}`);
        const p = data.player;
        if (!p?.id) return null;

        let age: number | null = null;
        if (p.dateOfBirthTimestamp) {
          const born = new Date(p.dateOfBirthTimestamp * 1000);
          const now = new Date();
          age = now.getFullYear() - born.getFullYear();
          const hadBirthday =
            now.getMonth() > born.getMonth() ||
            (now.getMonth() === born.getMonth() && now.getDate() >= born.getDate());
          if (!hadBirthday) age -= 1;
        }

        return {
          id: str(p.id),
          name: p.name ?? p.shortName ?? str(p.id),
          fullName: p.name ?? null,
          countryCode: p.nationality?.alpha2 ?? p.nationality?.alpha3 ?? null,
          currentRank: typeof p.ranking === "number" ? p.ranking : null,
          tour: p.gender === "F" ? "WTA" : p.gender === "M" ? "ATP" : null,
          age,
          plays: null,
        };
      } catch (err) {
        if (err instanceof ProviderUnavailableError) throw err;
        return null;
      }
    });
  }

  async getPlayerMatches(playerId: string): Promise<MatchRecord[]> {
    const key = `playerMatches:${playerId}`;
    return this.cache.getOrFetch(key, RESULTS_TTL_MS, async () => {
      const data = await this.call<RawResultsResponse>(`/api/tennis/player/${playerId}/results`);
      const events = data.events ?? [];
      const records: MatchRecord[] = [];
      for (const ev of events) {
        const r = mapEventToMatchRecord(ev, playerId);
        if (r) records.push(r);
      }
      return records;
    });
  }

  // ── Fixtures ─────────────────────────────────────────────────────────────

  async getUpcomingFixtures(date: string): Promise<Fixture[]> {
    // Let ProviderUnavailableError propagate — composite provider needs it to trigger fallback.
    return this.getUpcomingFixturesRange(date, date);
  }

  async getUpcomingFixturesRange(dateStart: string, dateStop: string, opts?: { bypassCache?: boolean }): Promise<Fixture[]> {
    // Collect fixtures for every date in the range.
    // Let ProviderUnavailableError propagate — composite provider needs it to trigger fallback.
    const dates: string[] = [];
    const d = new Date(`${dateStart}T00:00:00Z`);
    const stop = new Date(`${dateStop}T00:00:00Z`);
    while (d <= stop) {
      dates.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }

    const allFixtures: Fixture[] = [];
    for (const date of dates) {
      const [year, month, day] = date.split("-").map(Number);
      const key = `schedule:${date}`;
      const fixtures = await this.cache.getOrFetch(
        key,
        SCHEDULE_TTL_MS,
        async () => {
          const data = await this.call<RawScheduleResponse>(`/api/tennis/schedules/games/${year}/${month}/${day}`);
          const events = data.events ?? [];
          const mapped: Fixture[] = [];
          for (const ev of events) {
            const f = mapEventToFixture(ev);
            if (f) mapped.push(f);
          }
          return mapped;
        },
        { bypass: opts?.bypassCache },
      );
      allFixtures.push(...fixtures);
    }
    return allFixtures;
  }

  // ── H2H ──────────────────────────────────────────────────────────────────

  async getHeadToHead(player1Id: string, player2Id: string): Promise<HeadToHeadRecord> {
    const key = `h2h:${[player1Id, player2Id].sort().join(":")}`;
    return this.cache.getOrFetch(key, H2H_TTL_MS, async () => {
      const data = await this.call<RawH2HResponse>(`/api/tennis/players/h2h/${player1Id}/${player2Id}`);
      const events = data.events ?? [];
      const meetings = events
        .filter((ev) => ev.status?.type === "finished" && ev.winnerCode != null)
        .map((ev) => {
          const winnerId = ev.winnerCode === 1 ? str(ev.homeTeam?.id) : str(ev.awayTeam?.id);
          const scheduledStart = ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : null;
          const surface = mapSurface(ev.tournament?.uniqueTournament?.groundType);
          return {
            date: scheduledStart ? scheduledStart.slice(0, 10) : "",
            tournamentName: ev.tournament?.uniqueTournament?.name ?? ev.tournament?.name ?? null,
            surface,
            score: null,
            winnerId,
          };
        })
        .filter((m) => m.date && m.winnerId);

      return { player1Id, player2Id, meetings };
    });
  }

  // ── Not supported by this provider ────────────────────────────────────────

  async getCompletedMatchesByDateRange(): Promise<HistoricalFixture[]> {
    // Not provided by tennisapi1 — the historical backfill uses API-Tennis exclusively.
    return [];
  }

  async getLiveScores(_fixtureIds: string[]): Promise<Map<string, LiveScore>> {
    // tennisapi1 schedule endpoint includes live matches; live-score polling not separately supported.
    return new Map();
  }
}
