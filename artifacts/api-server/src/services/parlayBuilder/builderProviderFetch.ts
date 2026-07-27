/**
 * Live provider fetch for the Parlay Builder Validation Engine.
 *
 * When a player is absent from the local historical_matches cache after all
 * DB-layer resolution attempts, this module queries every configured external
 * tennis provider in the same order as the prediction engine, and returns
 * their match records for use as validation evidence.
 *
 * Required outcomes (per architecture spec):
 *
 *   CACHE_HIT         — found in local DB (caller sets this; not returned here)
 *   CACHE_MISS        — not in local DB; this module was invoked
 *   PLAYER_RESOLVED   — matched to a canonical provider identity
 *   DATA_FOUND        — match records retrieved from provider
 *   SOURCE_UNAVAILABLE — provider failed, timed out, or could not be queried
 *   PLAYER_NOT_FOUND  — provider responded successfully but found no matching player
 *   NO_MATCH_HISTORY  — player was identified; provider returned 0 completed matches
 *   DATA_UNAVAILABLE  — all configured providers are unreachable; scoring is impossible
 *
 * A successful fetch also writes records to historical_matches (non-blocking,
 * best-effort) so subsequent requests for the same player hit the DB cache.
 */

import { pool } from "@workspace/db";
import {
  getTennisDataProvider,
  ProviderUnavailableError,
  type MatchRecord,
  type PlayerSummary,
} from "../tennisData/index.js";
import { fetchFromSofascore } from "./sofascoreProvider.js";

// ─── Outcome & diagnostic types ──────────────────────────────────────────────

export type ResolutionOutcome =
  | "CACHE_HIT"
  | "CACHE_MISS"
  | "PLAYER_RESOLVED"
  | "DATA_FOUND"
  | "SOURCE_UNAVAILABLE"
  | "PLAYER_NOT_FOUND"
  | "NO_MATCH_HISTORY"
  | "DATA_UNAVAILABLE";

export interface ProviderSourceDiagnostic {
  source: string;
  attempted: boolean;
  succeeded: boolean;
  playerFound: boolean;
  recordsReturned: number;
  providerPlayerId?: string;
  failureReason?: string;
}

export interface LiveFetchDiagnostics {
  outcome: ResolutionOutcome;
  /** Every provider the app is configured to use. */
  sourcesConfigured: string[];
  /** Providers that were actually called this request. */
  sourcesAttempted: string[];
  /** Providers that returned a usable response. */
  sourcesSuccessful: string[];
  /** Providers that errored, timed out, or returned nothing. */
  sourcesFailed: string[];
  /** How the player identity was resolved (e.g. "full-name", "surname", "normalized"). */
  playerResolutionMethod: string;
  /** Provider name → provider-internal player ID found. */
  providerIdsFound: Record<string, string>;
  /** Provider name → number of match records returned. */
  recordsPerSource: Record<string, number>;
  /** Human-readable failure explanations. */
  failureReasons: string[];
  /** Per-provider detail — enough for an admin diagnostics panel. */
  sources: ProviderSourceDiagnostic[];
}

export interface LiveFetchResult {
  records: MatchRecord[];
  resolvedPlayerId: string | null;
  resolvedPlayerName: string | null;
  tour: string | null;
  diagnostics: LiveFetchDiagnostics;
}

// ─── Name-matching helpers ───────────────────────────────────────────────────

function extractSurname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? name).toLowerCase();
}

function extractFirstInitial(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.replace(/\./g, "").charAt(0).toUpperCase();
}

/**
 * Confidence check: does a provider candidate match the queried player?
 *
 * Requires both a surname match AND a first-initial match to prevent false
 * positives in common-surname collisions (e.g. "A. Singh" vs "D. Singh").
 */
function isConfidentSearchMatch(candidateName: string, queriedName: string): boolean {
  const qSurname = extractSurname(queriedName);
  const qInitial = extractFirstInitial(queriedName).toLowerCase();
  const cNorm = candidateName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (!cNorm.includes(qSurname)) return false;
  if (qInitial) {
    const cInitial = extractFirstInitial(candidateName).toLowerCase();
    if (cInitial !== qInitial) return false;
  }
  return true;
}

/**
 * Build a prioritised list of search queries for a player name, covering:
 * full name · surname · NFD-stripped name · without leading initial.
 */
function buildSearchQueries(playerName: string): string[] {
  const queries = new Set<string>();
  const trimmed = playerName.trim();

  // 1. Full name as given ("D. Singh", "Devvrat Singh")
  queries.add(trimmed);

  // 2. Surname only — broadest, filtered by initial in result check
  const surname = trimmed.split(/\s+/).pop() ?? trimmed;
  if (surname.length >= 3) queries.add(surname);

  // 3. NFD-normalised — strips diacritics (Đ→D, ę→e, Ø→O) and handles
  //    non-NFD letters that normalize() doesn't cover
  const nfd = trimmed
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ŁłÐðØøÆæ]/g, (c) =>
      ({ Ł: "L", ł: "l", Ð: "D", ð: "d", Ø: "O", ø: "o", Æ: "AE", æ: "ae" }[c] ?? c)
    );
  if (nfd !== trimmed) queries.add(nfd);
  const nfdSurname = nfd.split(/\s+/).pop() ?? nfd;
  if (nfdSurname !== surname && nfdSurname.length >= 3) queries.add(nfdSurname);

  // 4. Strip leading initial abbreviation: "D. Singh" → "Singh"
  const withoutInitial = trimmed.replace(/^[A-Z]\.\s*/, "");
  if (withoutInitial !== trimmed && withoutInitial.length >= 2) queries.add(withoutInitial);

  return [...queries].filter((q) => q.length >= 2);
}

/** Human-readable description of which search query led to a match. */
function classifySearchMethod(query: string, originalName: string): string {
  const t = originalName.trim();
  if (query === t) return "full-name";
  if (!query.includes(" ") && query.length < 15) return "surname";
  if (query !== t && query.replace(/\s/g, "") === t.replace(/\s/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")) return "nfd-normalized";
  return "name-variant";
}

// ─── DB cache write (non-blocking best-effort) ───────────────────────────────

async function saveMatchesToDb(
  records: MatchRecord[],
  playerId: string,
  playerName: string,
  tour: string | null,
  providerLabel: string,
): Promise<void> {
  for (const rec of records) {
    const winnerId = rec.result === "W" ? playerId : rec.opponentId;
    try {
      await pool.query(
        `INSERT INTO historical_matches (
          external_id, provider, tour,
          tournament_name, tournament_level, surface, round, match_format,
          player1_id, player1_name, player2_id, player2_name, winner_id,
          score, retired, walkover, cancelled,
          player2_rank, scheduled_start_at, imported_at
        ) VALUES (
          $1, $2, $3,
          $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          $14, $15, $16, false,
          $17, $18, NOW()
        )
        ON CONFLICT DO NOTHING`,
        [
          rec.id,
          providerLabel,
          tour,
          rec.tournamentName,
          rec.tournamentLevel,
          rec.surface,
          rec.round,
          rec.matchFormat,
          playerId,
          playerName,
          rec.opponentId,
          rec.opponentName,
          winnerId,
          rec.score,
          rec.retired,
          rec.walkover,
          rec.opponentRank,
          rec.date ? new Date(rec.date) : null,
        ]
      );
    } catch {
      // Silently swallow — cache write is best-effort, never blocks validation
    }
  }
}

// ─── Sofascore fallback helper ────────────────────────────────────────────────

/**
 * Attempt to resolve a player and their match history via Sofascore.
 * Called after the primary provider chain fails (PLAYER_NOT_FOUND or
 * NO_MATCH_HISTORY).  Updates `diag` in-place; returns a full LiveFetchResult
 * on success, or null when Sofascore also cannot provide data.
 */
async function attemptSofascore(
  playerName: string,
  diag: LiveFetchDiagnostics,
): Promise<LiveFetchResult | null> {
  const sfDiag: ProviderSourceDiagnostic = {
    source: "sofascore",
    attempted: true,
    succeeded: false,
    playerFound: false,
    recordsReturned: 0,
  };
  diag.sourcesAttempted.push("sofascore");

  try {
    const sfResult = await fetchFromSofascore(playerName);

    if (sfResult.error?.includes("rate-limit")) {
      sfDiag.failureReason = sfResult.error;
      diag.sourcesFailed.push("sofascore");
      diag.failureReasons.push(`sofascore: ${sfResult.error}`);
      diag.sources.push(sfDiag);
      return null;
    }

    if (sfResult.player && sfResult.records.length > 0) {
      sfDiag.succeeded = true;
      sfDiag.playerFound = true;
      sfDiag.providerPlayerId = sfResult.player.id;
      sfDiag.recordsReturned = sfResult.records.length;
      diag.sourcesSuccessful.push("sofascore");
      diag.providerIdsFound["sofascore"] = sfResult.player.id;
      diag.recordsPerSource["sofascore"] = sfResult.records.length;
      diag.outcome = "DATA_FOUND";
      if (diag.playerResolutionMethod === "none") {
        diag.playerResolutionMethod = "sofascore-search";
      }
      diag.sources.push(sfDiag);

      // Non-blocking DB cache write — next request for same player hits Layer 1
      saveMatchesToDb(
        sfResult.records,
        sfResult.player.id,
        sfResult.player.name,
        sfResult.player.tour ?? null,
        "builder-live-fetch:sofascore",
      ).catch(() => {});

      return {
        records: sfResult.records,
        resolvedPlayerId: sfResult.player.id,
        resolvedPlayerName: sfResult.player.name,
        tour: sfResult.player.tour ?? null,
        diagnostics: diag,
      };
    }

    if (sfResult.player) {
      // Player found but no completed match records on Sofascore either
      sfDiag.playerFound = true;
      sfDiag.providerPlayerId = sfResult.player.id;
      sfDiag.succeeded = true;
      sfDiag.recordsReturned = 0;
      diag.sourcesSuccessful.push("sofascore");
      diag.providerIdsFound["sofascore"] = sfResult.player.id;
      diag.outcome = "NO_MATCH_HISTORY";
    } else {
      sfDiag.failureReason = sfResult.error ?? "Player not found in Sofascore";
      diag.sourcesFailed.push("sofascore");
      // PLAYER_NOT_FOUND outcome stays as-is when both providers say not found
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    sfDiag.failureReason = reason;
    diag.sourcesFailed.push("sofascore");
    diag.failureReasons.push(`sofascore: ${reason}`);
  }

  diag.sources.push(sfDiag);
  return null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function fetchPlayerMatchesFromProviders(
  playerName: string,
  _context?: { opponentName?: string; tournamentName?: string },
): Promise<LiveFetchResult> {
  const provider = getTennisDataProvider();
  const providerName = provider.name;

  const diag: LiveFetchDiagnostics = {
    outcome: "CACHE_MISS",
    sourcesConfigured: [providerName, "sofascore"],
    sourcesAttempted: [],
    sourcesSuccessful: [],
    sourcesFailed: [],
    playerResolutionMethod: "none",
    providerIdsFound: {},
    recordsPerSource: {},
    failureReasons: [],
    sources: [],
  };

  const sourceDiag: ProviderSourceDiagnostic = {
    source: providerName,
    attempted: false,
    succeeded: false,
    playerFound: false,
    recordsReturned: 0,
  };

  diag.sourcesAttempted.push(providerName);
  sourceDiag.attempted = true;

  // ── Step 1: Search for the player using progressive name variants ─────────
  const searchQueries = buildSearchQueries(playerName);
  let foundPlayer: PlayerSummary | null = null;
  let searchMethod = "none";
  let providerUnavailable = false;

  for (const query of searchQueries) {
    try {
      const results = await provider.searchPlayers(query);
      const match = results.find((r) => isConfidentSearchMatch(r.name, playerName));
      if (match) {
        foundPlayer = match;
        searchMethod = classifySearchMethod(query, playerName);
        break;
      }
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        providerUnavailable = true;
        const reason = err.message;
        sourceDiag.failureReason = reason;
        diag.sourcesFailed.push(providerName);
        diag.failureReasons.push(`${providerName} search: ${reason}`);
        break; // No point retrying other variants if the provider is down
      }
      // Non-fatal (unexpected error on one variant) — try next variant
    }
  }

  if (providerUnavailable) {
    diag.outcome = "SOURCE_UNAVAILABLE";
    diag.sources.push(sourceDiag);
    return {
      records: [],
      resolvedPlayerId: null,
      resolvedPlayerName: null,
      tour: null,
      diagnostics: diag,
    };
  }

  if (!foundPlayer) {
    diag.outcome = "PLAYER_NOT_FOUND";
    diag.playerResolutionMethod = "none";
    diag.sources.push(sourceDiag);
    // ── Sofascore fallback: primary provider couldn't find the player ─────
    const sfResult1 = await attemptSofascore(playerName, diag);
    if (sfResult1) return sfResult1;
    return {
      records: [],
      resolvedPlayerId: null,
      resolvedPlayerName: null,
      tour: null,
      diagnostics: diag,
    };
  }

  // ── Step 2: Fetch match history for the resolved player ───────────────────
  sourceDiag.playerFound = true;
  sourceDiag.providerPlayerId = foundPlayer.id;
  diag.providerIdsFound[providerName] = foundPlayer.id;
  diag.playerResolutionMethod = searchMethod;
  diag.outcome = "PLAYER_RESOLVED";

  let records: MatchRecord[] = [];
  try {
    records = await provider.getPlayerMatches(foundPlayer.id);
    sourceDiag.succeeded = true;
    sourceDiag.recordsReturned = records.length;
    diag.sourcesSuccessful.push(providerName);
    diag.recordsPerSource[providerName] = records.length;

    if (records.length === 0) {
      diag.outcome = "NO_MATCH_HISTORY";
    } else {
      diag.outcome = "DATA_FOUND";
      // Non-blocking DB cache write — subsequent requests for the same player
      // will hit the local DB instead of calling the provider again.
      const providerLabel = `builder-live-fetch:${providerName}`;
      saveMatchesToDb(
        records,
        foundPlayer.id,
        foundPlayer.name,
        foundPlayer.tour ?? null,
        providerLabel,
      ).catch(() => {
        /* silently ignored — cache write is best-effort */
      });
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    sourceDiag.failureReason = reason;
    diag.sourcesFailed.push(providerName);
    diag.failureReasons.push(`${providerName} getPlayerMatches(${foundPlayer.id}): ${reason}`);
    diag.outcome = "SOURCE_UNAVAILABLE";
  }

  diag.sources.push(sourceDiag);

  // ── Sofascore fallback: player found but provider returned 0 match records ─
  if (records.length === 0) {
    const sfResult2 = await attemptSofascore(playerName, diag);
    if (sfResult2) return sfResult2;
  }

  return {
    records,
    resolvedPlayerId: foundPlayer.id,
    resolvedPlayerName: foundPlayer.name,
    tour: foundPlayer.tour ?? null,
    diagnostics: diag,
  };
}
