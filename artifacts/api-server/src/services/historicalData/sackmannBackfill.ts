/**
 * Sackmann historical backfill.
 *
 * Downloads Jeff Sackmann's tennis_atp / tennis_wta GitHub CSVs and inserts their match records
 * into historical_matches via the existing backfill infrastructure (so feature snapshots, Elo
 * state, and idempotency all work exactly as they do for API-Tennis data).
 *
 * Sources (main-draw):
 *  ATP: https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_YYYY.csv
 *  WTA: https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_matches_YYYY.csv
 *
 * Sources (Challenger / qualifying / ITF — enabled by default via includeChallengerItf option):
 *  ATP: https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_qual_chall_YYYY.csv
 *  WTA: https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_matches_qual_itf_YYYY.csv
 *
 * These supplementary files share the same schema as the main-draw files so the same parser
 * applies. The ATP file contains ATP Challenger events AND qualifying-round matches at main-tour
 * events (tagged by the parent tournament's level code). The WTA file contains WTA ITF events
 * AND qualifying rounds.
 *
 * External calls made per run: one HTTP GET per CSV file (year × tour × file variant). No auth
 * required. All CSV data is fetched up-front and cached in memory for the duration of the run;
 * the provider's `getCompletedMatchesByDateRange` simply filters the in-memory array, so the
 * existing 5-day-chunk pattern in runHistoricalBackfill stays fully intact.
 */
import { runHistoricalBackfill } from "./backfill";
import type { BackfillSummary } from "./types";
import { ProviderUnavailableError } from "../tennisData/types";
import type {
  TennisDataProvider,
  HistoricalFixture,
  Surface,
  TournamentLevel,
  MatchFormat,
  PlayerSummary,
  PlayerProfile,
  MatchRecord,
  Fixture,
  HeadToHeadRecord,
  LiveScore,
} from "../tennisData/types";
import { logger } from "../../lib/logger";

// ── Constants ─────────────────────────────────────────────────────────────────

export const SACKMANN_PROVIDER = "sackmann";

const ATP_BASE_URL = "https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master";
const WTA_BASE_URL = "https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master";
const FETCH_TIMEOUT_MS = 30_000;

// ── CSV parsing ───────────────────────────────────────────────────────────────

/** Minimal RFC-4180-compatible CSV row parser. */
function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { fields.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvRow(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = values[j]?.trim() ?? "";
    }
    rows.push(row);
  }
  return rows;
}

// ── Type mappings ─────────────────────────────────────────────────────────────

function mapSurface(raw: string): Surface | null {
  const s = raw.toLowerCase();
  if (s === "hard") return "Hard";
  if (s === "clay") return "Clay";
  if (s === "grass") return "Grass";
  if (s === "carpet") return "IndoorHard"; // Carpet was indoor hard equivalent
  return null;
}

function mapAtpLevel(level: string, drawSize: number): TournamentLevel | null {
  switch (level) {
    case "G": return "GrandSlam";
    case "M": return "Masters1000";
    case "F": return "Masters1000"; // ATP Finals — closest bucket
    case "A": return drawSize >= 56 ? "ATP500" : "ATP250";
    case "C": return "Challenger";
    case "S": return "ITF";
    default:  return null; // Davis Cup "D", Laver Cup, etc.
  }
}

function mapWtaLevel(level: string): TournamentLevel | null {
  switch (level) {
    case "G":  return "GrandSlam";
    case "P":
    case "PM": return "WTA1000";    // Premier / Premier Mandatory
    case "I":  return "WTA500";     // International (main-draw file usage)
    case "F":  return "WTA1000";    // WTA Finals
    case "C":  return "Challenger";
    case "S":  return "ITF";
    // Codes that appear in the wta_matches_qual_itf files:
    // "ITF" prefix levels (e.g. "ITF", "Q") — stored as the tournament type in those files.
    // Map them to ITF; any unrecognised code returns null but the match is still imported.
    case "Q":  return "ITF";        // Qualifying events / ITF circuits in WTA qual file
    case "2":  return "ITF";        // ITF W15/W25 level codes used in older qual files
    case "3":  return "ITF";        // ITF W40/W60
    default:   return null;
  }
}

/** Parse set-by-set game margins from a Sackmann score string (winner is always player1). */
function parseSetMargins(score: string): Array<{ player1Games: number; player2Games: number }> {
  if (!score || /^(W\/O|DEF\.?|BYE|UNK)$/i.test(score.trim())) return [];
  const result: Array<{ player1Games: number; player2Games: number }> = [];
  for (const token of score.trim().split(/\s+/)) {
    const m = token.match(/^(\d+)-(\d+)/);
    if (m) {
      result.push({ player1Games: parseInt(m[1]), player2Games: parseInt(m[2]) });
    }
  }
  return result;
}

/** Convert Sackmann tourney_date (YYYYMMDD string) to YYYY-MM-DD. */
function sackmannDateToIso(raw: string): string | null {
  if (!raw || raw.length < 8) return null;
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  const candidate = `${y}-${m}-${d}`;
  return Number.isNaN(Date.parse(candidate)) ? null : candidate;
}

function intOrNull(s: string): number | null {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Row → HistoricalFixture ───────────────────────────────────────────────────

function rowToFixture(
  row: Record<string, string>,
  tour: "ATP" | "WTA",
): HistoricalFixture | null {
  const tourneyDate = sackmannDateToIso(row.tourney_date);
  if (!tourneyDate) return null;

  const winnerId = row.winner_id?.trim();
  const loserId  = row.loser_id?.trim();
  if (!winnerId || !loserId || !row.match_num?.trim()) return null;

  const externalId = `${row.tourney_id?.trim() ?? "?"}-${row.match_num.trim()}`;
  const score = row.score?.trim() ?? null;
  const isRetired   = !!score && /ret/i.test(score);
  const isWalkover  = !!score && /w\/o|walkover/i.test(score);
  const drawSize    = parseInt(row.draw_size ?? "0", 10) || 0;
  const level       = tour === "ATP"
    ? mapAtpLevel(row.tourney_level ?? "", drawSize)
    : mapWtaLevel(row.tourney_level ?? "");
  const bestOf      = row.best_of?.trim() === "5" ? "BestOf5" : "BestOf3" as MatchFormat;
  // In Sackmann: winner is always "player1" (id / name comes from winner_* columns)
  const p1Id   = `${SACKMANN_PROVIDER}-${winnerId}`;
  const p2Id   = `${SACKMANN_PROVIDER}-${loserId}`;
  const p1Name = row.winner_name?.trim() ?? "";
  const p2Name = row.loser_name?.trim() ?? "";

  return {
    id: externalId,
    provider: SACKMANN_PROVIDER,
    date: tourneyDate,
    time: null,
    tour,
    tournamentName: row.tourney_name?.trim() || null,
    tournamentLevel: level,
    round: row.round?.trim() || null,
    surface: mapSurface(row.surface ?? ""),
    matchFormat: bestOf,
    player1Id: p1Id,
    player1Name: p1Name,
    player2Id: p2Id,
    player2Name: p2Name,
    winnerId: p1Id, // winner is always player1 in Sackmann
    score,
    retired: isRetired,
    walkover: isWalkover,
    cancelled: false,
    setGameMargins: parseSetMargins(score ?? ""),
    indoor: null,
    player1Rank: intOrNull(row.winner_rank ?? ""),
    player2Rank: intOrNull(row.loser_rank ?? ""),
    raw: row,
  };
}

// ── CSV fetching ──────────────────────────────────────────────────────────────

async function fetchCsvYear(url: string): Promise<Record<string, string>[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 404) return []; // Year doesn't exist yet
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    return parseCsv(text);
  } finally {
    clearTimeout(timer);
  }
}

// ── Minimal TennisDataProvider wrapper ────────────────────────────────────────

/**
 * Wraps a pre-loaded array of HistoricalFixtures so that the existing runHistoricalBackfill
 * infrastructure can consume it. Only getCompletedMatchesByDateRange is meaningful; all other
 * methods throw ProviderUnavailableError because runHistoricalBackfill never calls them.
 */
class SackmannProvider implements TennisDataProvider {
  readonly name = "SackmannProvider";
  private readonly fixtures: HistoricalFixture[];

  constructor(fixtures: HistoricalFixture[]) {
    this.fixtures = fixtures;
  }

  async getCompletedMatchesByDateRange(dateStart: string, dateStop: string): Promise<HistoricalFixture[]> {
    return this.fixtures.filter((f) => f.date >= dateStart && f.date <= dateStop);
  }

  // ── Stubs for unused methods ────────────────────────────────────────────────
  private _unavailable(method: string): never {
    throw new ProviderUnavailableError(`SackmannProvider does not implement ${method}`);
  }
  getStatus(): import("../tennisData/types").ProviderStatusInfo {
    return { provider: SACKMANN_PROVIDER, connected: true, lastSuccessfulCallAt: null, lastError: null };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async searchPlayers(_query: string): Promise<PlayerSummary[]>           { return this._unavailable("searchPlayers"); }
  async getPlayer(_id: string): Promise<PlayerProfile | null>             { return this._unavailable("getPlayer"); }
  async getPlayerMatches(_id: string): Promise<MatchRecord[]>             { return this._unavailable("getPlayerMatches"); }
  async getUpcomingFixtures(_date: string): Promise<Fixture[]>            { return this._unavailable("getUpcomingFixtures"); }
  async getUpcomingFixturesRange(_s: string, _e: string): Promise<Fixture[]> { return this._unavailable("getUpcomingFixturesRange"); }
  async getHeadToHead(_p1: string, _p2: string): Promise<HeadToHeadRecord> { return this._unavailable("getHeadToHead"); }
  async getLiveScores(_ids: string[]): Promise<Map<string, LiveScore>>    { return this._unavailable("getLiveScores"); }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SackmannBackfillOptions {
  /** First year to backfill. Defaults to 2010. */
  startYear?: number;
  /** Last year to backfill (inclusive). Defaults to the current calendar year. */
  endYear?: number;
  /** Which tours to include. Defaults to both. */
  tours?: Array<"atp" | "wta">;
  /**
   * Also fetch Challenger/qualifying (ATP: atp_matches_qual_chall_YYYY.csv) and
   * ITF/qualifying (WTA: wta_matches_qual_itf_YYYY.csv) files from the same repos.
   *
   * These files contain match history for Challenger-level and ITF players who rarely appear
   * in the main-draw file — the exact population that drives "Limited/Poor Data Quality" and
   * "Extreme Upset Risk" flags. Defaults to `true`.
   */
  includeChallengerItf?: boolean;
}

export interface SackmannBackfillSummary {
  atpYearsLoaded: number;
  wtaYearsLoaded: number;
  /** Years successfully loaded from atp_matches_qual_chall_YYYY.csv (0 if includeChallengerItf was false). */
  atpChallengerYearsLoaded: number;
  /** Years successfully loaded from wta_matches_qual_itf_YYYY.csv (0 if includeChallengerItf was false). */
  wtaItfYearsLoaded: number;
  fixturesLoaded: number;
  backfill: BackfillSummary;
}

/**
 * Downloads Sackmann CSVs for the requested year range, maps them to HistoricalFixture[], then
 * calls the standard runHistoricalBackfill so all feature snapshots, Elo state, and
 * idempotency guarantees are identical to the live-provider path.
 */
export async function runSackmannBackfill(
  options: SackmannBackfillOptions = {},
): Promise<SackmannBackfillSummary> {
  const currentYear       = new Date().getFullYear();
  const startYear         = options.startYear          ?? 2010;
  const endYear           = options.endYear            ?? currentYear;
  const tours             = options.tours              ?? ["atp", "wta"];
  const includeChallengerItf = options.includeChallengerItf ?? true;

  if (startYear > endYear) throw new Error(`startYear (${startYear}) > endYear (${endYear})`);

  const allFixtures: HistoricalFixture[] = [];
  let atpYearsLoaded          = 0;
  let wtaYearsLoaded          = 0;
  let atpChallengerYearsLoaded = 0;
  let wtaItfYearsLoaded        = 0;

  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);

  /**
   * Fetches one CSV URL, maps rows to HistoricalFixture[], and appends to allFixtures.
   * Returns the number of valid fixtures loaded (0 on 404 or error).
   */
  async function fetchAndAppend(url: string, tourLabel: "ATP" | "WTA", context: string): Promise<number> {
    try {
      const rows = await fetchCsvYear(url);
      if (rows.length === 0) return 0;
      const fixtures = rows
        .map((r) => rowToFixture(r, tourLabel))
        .filter((f): f is HistoricalFixture => f !== null);
      allFixtures.push(...fixtures);
      logger.info({ url: context, rows: rows.length, fixtures: fixtures.length }, "sackmannBackfill: file loaded");
      return fixtures.length;
    } catch (err) {
      logger.warn({ err, url: context }, "sackmannBackfill: failed to load file (non-fatal)");
      return 0;
    }
  }

  // Fetch all CSV files in parallel (capped to avoid hammering GitHub).
  // For each (year, tour) pair we fetch:
  //   1. The main-draw file: atp_matches_YYYY.csv / wta_matches_YYYY.csv
  //   2. (if includeChallengerItf) The supplementary file:
  //        ATP: atp_matches_qual_chall_YYYY.csv — ATP Challengers + qualifying rounds
  //        WTA: wta_matches_qual_itf_YYYY.csv   — WTA ITF events + qualifying rounds
  const concurrency = 4; // slightly lower to be courteous to GitHub with 2× the file requests
  for (let i = 0; i < years.length; i += concurrency) {
    const batch = years.slice(i, i + concurrency);
    await Promise.all(
      batch.flatMap((year) =>
        tours.flatMap((tour) => {
          const base     = tour === "atp" ? ATP_BASE_URL : WTA_BASE_URL;
          const prefix   = tour === "atp" ? "atp" : "wta";
          const tourLabel: "ATP" | "WTA" = tour === "atp" ? "ATP" : "WTA";

          const tasks: Promise<void>[] = [];

          // ── Main-draw file ───────────────────────────────────────────────
          const mainUrl = `${base}/${prefix}_matches_${year}.csv`;
          tasks.push(
            fetchAndAppend(mainUrl, tourLabel, `${prefix}_matches_${year}`).then((count) => {
              if (count > 0) {
                if (tour === "atp") atpYearsLoaded++;
                else wtaYearsLoaded++;
              }
            }),
          );

          // ── Challenger / ITF supplementary file ─────────────────────────
          if (includeChallengerItf) {
            const chalUrl = tour === "atp"
              ? `${base}/${prefix}_matches_qual_chall_${year}.csv`
              : `${base}/${prefix}_matches_qual_itf_${year}.csv`;
            const chalLabel = tour === "atp"
              ? `${prefix}_matches_qual_chall_${year}`
              : `${prefix}_matches_qual_itf_${year}`;
            tasks.push(
              fetchAndAppend(chalUrl, tourLabel, chalLabel).then((count) => {
                if (count > 0) {
                  if (tour === "atp") atpChallengerYearsLoaded++;
                  else wtaItfYearsLoaded++;
                }
              }),
            );
          }

          return tasks;
        }),
      ),
    );
  }

  if (allFixtures.length === 0) {
    logger.warn({ startYear, endYear, tours, includeChallengerItf }, "sackmannBackfill: no fixtures loaded");
    const emptyDate = `${startYear}-01-01`;
    return {
      atpYearsLoaded: 0,
      wtaYearsLoaded: 0,
      atpChallengerYearsLoaded: 0,
      wtaItfYearsLoaded: 0,
      fixturesLoaded: 0,
      backfill: {
        dateStart: emptyDate,
        dateStop: `${endYear}-12-31`,
        cutoff: "30min",
        cutoffMinutes: 30,
        fixturesFetched: 0,
        matchesInserted: 0,
        matchesSkippedDuplicate: 0,
        matchesSkippedNoTerminalResult: 0,
        matchesRecomputed: 0,
        featureRowsInserted: 0,
        byTour: {},
        bySurface: {},
        byYear: {},
        earliestImportedMatchDate: null,
        latestImportedMatchDate: null,
        dateGapsOver30Days: [],
        durationMs: 0,
      } satisfies BackfillSummary,
    };
  }

  // Sort so the provider can be queried by date range correctly
  allFixtures.sort((a, b) => a.date.localeCompare(b.date));
  const dateStart = allFixtures[0].date;
  const dateStop  = allFixtures[allFixtures.length - 1].date;

  logger.info(
    {
      fixturesLoaded: allFixtures.length,
      atpYearsLoaded, wtaYearsLoaded,
      atpChallengerYearsLoaded, wtaItfYearsLoaded,
      includeChallengerItf,
      dateStart, dateStop,
    },
    "sackmannBackfill: all CSVs loaded, starting historical backfill",
  );

  const provider = new SackmannProvider(allFixtures);
  const backfill = await runHistoricalBackfill(
    provider as unknown as Parameters<typeof runHistoricalBackfill>[0],
    {
      dateStart,
      dateStop,
      // Use "1h" so the cutoff window is wide enough for same-day scheduling uncertainty.
      // Sackmann data has no match times (only dates), so the recorded start is midnight UTC;
      // a 30-min cutoff would be fine numerically but 1h gives a comfortable margin.
      cutoff: "1h",
      chunkDays: 30, // Larger chunks are fine since we're serving from memory, not a live API
    },
  );

  return { atpYearsLoaded, wtaYearsLoaded, atpChallengerYearsLoaded, wtaItfYearsLoaded, fixturesLoaded: allFixtures.length, backfill };
}

// ── Test-only named exports ───────────────────────────────────────────────────
// Not part of the public API. Exported with underscore prefix so call-sites are
// visibly out-of-module-contract. Used by sackmannBackfillChallengerItf.test.ts
// to white-box-test the CSV parsing logic without re-implementing it locally.
export {
  rowToFixture    as _rowToFixture,
  mapWtaLevel     as _mapWtaLevel,
  mapAtpLevel     as _mapAtpLevel,
  intOrNull       as _intOrNull,
};
