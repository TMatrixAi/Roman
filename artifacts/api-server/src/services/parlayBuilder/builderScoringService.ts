/**
 * Independent Parlay Builder — Validation Scoring Engine
 *
 * Core architectural principle: this service NEVER reads from the predictions table,
 * NEVER uses calibratedProbability, safetyScore, or any Prediction Engine output.
 * It validates the Prediction Engine's selected winner using only independent evidence:
 * raw historical match data, rankings, and market consensus.
 *
 * Input:  BuilderSnapshot (who was selected, raw match context)
 * Output: BuilderResult (ValidationScore, RiskScore, Grade, Decision, Reasons)
 */

import { pool } from "@workspace/db";
import {
  getCachedPlayerIdentityIndex,
  canonicalizePlayerId,
  getAliasIds,
  resolvePlayerNameWithAmbiguity,
  type PlayerIdentityIndex,
} from "../tennisData/playerIdentity.js";
import {
  fetchPlayerMatchesFromProviders,
  type LiveFetchDiagnostics,
  type ResolutionOutcome,
} from "./builderProviderFetch.js";
import { researchPlayerMatchup } from "./webResearchService.js";
import { scrapeMatchstatPlayer, type MatchstatPlayerData } from "./matchstatScraper.js";

export const BUILDER_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Read-only snapshot from the Prediction Engine — contains ONLY who was selected and raw context. */
export interface BuilderSnapshot {
  selectedPlayerId: string;
  selectedPlayerName: string;
  opponentId: string;
  opponentName: string;
  surface: string | null;
  tournamentName: string | null;
  marketOdds?: number | null; // decimal odds for the selected player (user-supplied, not engine output)
  /**
   * Backfill mode: when set, all historical_matches queries are gated to rows
   * with scheduled_start_at < asOfDate so no future data leaks into the score.
   * Layer 5 (live provider fetch) is skipped automatically — we never want API
   * calls or quota consumption during a historical backfill.
   * Live /validate calls never set this field.
   */
  asOfDate?: Date;
}

export interface FactorScore {
  key: string;
  label: string;
  score: number;             // 0–100; 50 = neutral; >50 favors selected player
  weight: number;            // spec-defined weight (0–1)
  status: "available" | "unavailable" | "limited";
  supportsSelected: boolean | null; // null when unavailable
  detail: string;
}

/**
 * Three distinct data states, each requiring different treatment:
 *   data_available    — ≥5 matches found (DB or live provider), real factor scores computable
 *   insufficient_data — 1–4 matches found, limited signal
 *   player_not_found  — 0 matches after all DB layers AND live provider search
 */
export type PlayerDataStatus = "data_available" | "insufficient_data" | "player_not_found";

export interface DataSourceDiagnostics {
  selectedPlayerStatus: PlayerDataStatus;
  opponentStatus: PlayerDataStatus;
  selectedPlayerMatchCount: number;
  opponentMatchCount: number;
  h2hMatchCount: number;
  /** How the selected player's ID/data was resolved. */
  selectedPlayerResolvedVia?: string;
  /** How the opponent's ID/data was resolved. */
  opponentResolvedVia?: string;
  /**
   * Provider-level diagnostics for the selected player's live fetch,
   * populated only when the local DB had no data (all DB layers returned empty).
   */
  selectedPlayerProviderDiag?: LiveFetchDiagnostics;
  /**
   * Provider-level diagnostics for the opponent's live fetch,
   * populated only when the local DB had no data.
   */
  opponentProviderDiag?: LiveFetchDiagnostics;
  /**
   * True when at least one player had 0 local rows AND the provider was
   * unreachable (SOURCE_UNAVAILABLE). A Grade D or REMOVE from zero data
   * is misleading in this case — the frontend should show DATA_UNAVAILABLE.
   */
  isProviderOutage?: boolean;
  /** Set when data is available but limited; explains why scores may be low-confidence. */
  dataConfidenceNote?: string;
}

export interface BuilderResult {
  validationScore: number;   // 0–100
  riskScore: number;         // 0–100, higher = more risk
  reliabilityGrade: "A" | "B" | "C" | "D" | "F";
  parlayGrade: "Elite" | "Strong" | "Moderate" | "Weak" | "Reject";
  removalProbability: number; // 0–100%
  /**
   * KEEP / BORDERLINE / REMOVE — standard outcomes.
   * DATA_UNAVAILABLE — all providers unreachable; no grade should be displayed.
   */
  decision: "KEEP" | "BORDERLINE" | "REMOVE" | "DATA_UNAVAILABLE";
  reasons: string[];         // 3–6 evidence-based reasons
  criticalFlags: string[];
  dataCoverage: number;      // 0–100%, proportion of spec factor-weights that have real data
  sourceAgreement: number;   // 0–100%, proportion of OPINIONATED sources supporting selected
  sourcesAgreeing: number;   // count of factors that actively support the selection
  sourcesTotal: number;      // count of factors that took a side (supportsSelected !== null)
  factorScores: FactorScore[];
  dataSourceDiagnostics: DataSourceDiagnostics;
  builderVersion: string;
}

// ---------------------------------------------------------------------------
// Default weights (total = 1.00, per spec)
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS: Record<string, number> = {
  overallAdvantage:      0.18,
  surfaceAdvantage:      0.10,
  utr:                   0.10,  // no public API — unavailable
  recentForm:            0.10,
  surfaceRecord:         0.08,
  serveAdvantage:        0.06,  // not in historical_matches — unavailable
  returnAdvantage:       0.06,  // not in historical_matches — unavailable
  holdBreak:             0.05,  // not in historical_matches — unavailable
  strengthOfSchedule:    0.05,
  marketConsensus:       0.05,
  rankingTrend:          0.04,
  headToHead:            0.03,
  travelFatigue:         0.03,
  injuryRisk:            0.03,  // no verified real-time source — unavailable
  tournamentExperience:  0.02,
  historicalConsistency: 0.02,
  historicalVolatility:  0.02,
  dataQuality:           0.02,
  sourceAgreement:       0.06,
};

const STRUCTURALLY_UNAVAILABLE = new Set([
  "utr", "serveAdvantage", "returnAdvantage", "holdBreak",
  // injuryRisk removed: now computed via Gemini web research (Tier 5)
]);

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Convert a selected–opponent difference into a 0–100 factor score (50 = neutral). */
function diffScore(selVal: number, oppVal: number, scale: number): number {
  return Math.round(50 + clamp((selVal - oppVal) * scale, -50, 50));
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface MatchRow {
  player1_id: string;
  player2_id: string;
  winner_id: string | null;
  player1_rank: number | null;
  player2_rank: number | null;
  surface: string | null;
  tournament_name: string | null;
  scheduled_start_at: Date | null;
  retired: boolean | null;
  walkover: boolean | null;
}

// ---------------------------------------------------------------------------
// Multi-source player ID resolution
// ---------------------------------------------------------------------------
//
// The builder previously queried historical_matches only by the raw player_key
// supplied by the fixture. If that key differed from what's stored (different
// provider namespace, fragmented alias, abbreviated name), it returned 0 rows
// and immediately flagged the player as "not found" — even when 50+ matches
// existed under a different key or name.
//
// This helper tries four progressively-broader layers before giving up:
//   1. Direct ID lookup   — fastest path, works when IDs match exactly
//   2. Identity index     — canonicalizes the ID and fetches all alias IDs,
//                           handles provider-fragmented IDs (e.g. API-Tennis
//                           vs MatchStat IDs for the same player)
//   3. Name via index     — resolves the supplied player name against the
//                           identity index; catches mismatched IDs where the
//                           name resolves cleanly
//   4. DB name search     — direct ILIKE on player1_name/player2_name with
//                           surname + initial filter; catches players absent
//                           from the index (single-appearance players)
//
// Rows are normalised so player1_id / player2_id / winner_id all use the
// resolved canonical ID, making computePlayerStats work correctly regardless
// of which layer found the data.

/** Normalise all alias IDs in a set of match rows to a single canonical value. */
function normalizeMatchRowIds(rows: MatchRow[], aliasSet: Set<string>, canonicalId: string): MatchRow[] {
  return rows.map(r => ({
    ...r,
    player1_id: aliasSet.has(r.player1_id) ? canonicalId : r.player1_id,
    player2_id: aliasSet.has(r.player2_id) ? canonicalId : r.player2_id,
    winner_id: r.winner_id != null && aliasSet.has(r.winner_id) ? canonicalId : r.winner_id,
  }));
}

/**
 * Build the 2-year history SELECT with a parameterised IN clause.
 *
 * When asOfDateParamIdx is provided the query is gated to:
 *   scheduled_start_at < $N          (exclude the target match and any after it)
 *   scheduled_start_at > $N - 2yr   (rolling 2-year window relative to asOfDate)
 * When omitted the window is relative to NOW() — live behaviour unchanged.
 */
function buildHistorySQL(idCount: number, startParam = 1, asOfDateParamIdx?: number): string {
  const ids = Array.from({ length: idCount }, (_, i) => `$${startParam + i}`).join(", ");
  const dateCond = asOfDateParamIdx != null
    ? `AND scheduled_start_at < $${asOfDateParamIdx}
       AND scheduled_start_at > $${asOfDateParamIdx} - INTERVAL '2 years'`
    : `AND scheduled_start_at > NOW() - INTERVAL '2 years'`;
  return `
    SELECT player1_id, player2_id, winner_id, player1_rank, player2_rank,
           surface, tournament_name, scheduled_start_at, retired, walkover
    FROM historical_matches
    WHERE (player1_id IN (${ids}) OR player2_id IN (${ids}))
      AND (cancelled IS NULL OR cancelled = false)
      AND (walkover IS NULL OR walkover = false)
      ${dateCond}
    ORDER BY scheduled_start_at DESC
    LIMIT 60
  `;
}

interface PlayerResolution {
  rows: MatchRow[];
  resolvedId: string;          // canonical ID to use for win/loss computation
  resolvedVia: "direct" | "identity-index" | "name-index" | "db-name-search" | "provider-fetch" | "none";
  aliasIds: string[];          // all IDs that belong to this player in our DB
  liveFetchDiagnostics?: LiveFetchDiagnostics; // populated when Layer 5 was attempted
}

/** Convert provider MatchRecord[] (player-perspective) into MatchRow[] for scoring. */
function matchRecordsToRows(records: import("../tennisData/types.js").MatchRecord[], playerId: string): MatchRow[] {
  return records.map(rec => ({
    player1_id: playerId,
    player2_id: rec.opponentId,
    winner_id: rec.result === "W" ? playerId : rec.opponentId,
    player1_rank: null,          // MatchRecord is player-perspective; own rank not returned
    player2_rank: rec.opponentRank,
    surface: rec.surface,
    tournament_name: rec.tournamentName,
    scheduled_start_at: rec.date ? new Date(rec.date) : null,
    retired: rec.retired,
    walkover: rec.walkover,
  }));
}

async function resolvePlayerMatchRows(
  rawId: string,
  playerName: string,
  index: PlayerIdentityIndex,
  asOfDate?: Date,
): Promise<PlayerResolution> {
  // ── Layer 1: direct ID ────────────────────────────────────────────────────
  const asOfIdx1 = asOfDate != null ? 2 : undefined;
  const direct = await pool.query<MatchRow>(
    buildHistorySQL(1, 1, asOfIdx1),
    asOfDate != null ? [rawId, asOfDate] : [rawId],
  );
  if (direct.rows.length > 0) {
    return { rows: direct.rows, resolvedId: rawId, resolvedVia: "direct", aliasIds: [rawId] };
  }

  // ── Layer 2: identity index — canonical ID + all provider aliases ─────────
  const canonical2 = canonicalizePlayerId(index, rawId, playerName);
  const aliases2 = getAliasIds(index, canonical2);
  const allIds2 = [...new Set([rawId, canonical2, ...aliases2])];
  // Only bother querying if we actually found aliases beyond the raw ID
  if (allIds2.length > 1) {
    const asOfIdx2 = asOfDate != null ? allIds2.length + 1 : undefined;
    const res2 = await pool.query<MatchRow>(
      buildHistorySQL(allIds2.length, 1, asOfIdx2),
      asOfDate != null ? [...allIds2, asOfDate] : allIds2,
    );
    if (res2.rows.length > 0) {
      const aliasSet2 = new Set(allIds2);
      return {
        rows: normalizeMatchRowIds(res2.rows, aliasSet2, canonical2),
        resolvedId: canonical2,
        resolvedVia: "identity-index",
        aliasIds: allIds2,
      };
    }
  }

  // ── Layer 3: name resolution via identity index ───────────────────────────
  const nameHit = resolvePlayerNameWithAmbiguity(index, playerName);
  if (nameHit && !nameHit.ambiguous) {
    const canonical3 = nameHit.id;
    const aliases3 = getAliasIds(index, canonical3);
    const allIds3 = [...new Set([canonical3, ...aliases3])];
    const asOfIdx3 = asOfDate != null ? allIds3.length + 1 : undefined;
    const res3 = await pool.query<MatchRow>(
      buildHistorySQL(allIds3.length, 1, asOfIdx3),
      asOfDate != null ? [...allIds3, asOfDate] : allIds3,
    );
    if (res3.rows.length > 0) {
      const aliasSet3 = new Set(allIds3);
      return {
        rows: normalizeMatchRowIds(res3.rows, aliasSet3, canonical3),
        resolvedId: canonical3,
        resolvedVia: "name-index",
        aliasIds: allIds3,
      };
    }
  }

  // ── Layer 4: direct DB name search (surname + initial filter) ────────────
  // Handles players present in historical_matches but absent from the index
  // (e.g. players who appear only once — not enough sightings to be indexed).
  const nameParts = playerName.trim().split(/\s+/);
  const surname = nameParts[nameParts.length - 1] ?? "";
  // Derive the first initial: handle "D. Singh" → "D" and "Devvrat Singh" → "D"
  const firstToken = nameParts[0] ?? "";
  const firstInitial = firstToken.replace(".", "").charAt(0).toUpperCase();

  if (surname.length >= 3) {
    interface NameRow { pid: string; pname: string; cnt: string }
    // In backfill mode gate the name search to the same temporal window.
    const nameSearchDateCond = asOfDate != null
      ? `AND scheduled_start_at < $2 AND scheduled_start_at > $2 - INTERVAL '2 years'`
      : `AND scheduled_start_at > NOW() - INTERVAL '2 years'`;
    const nameSearchParams: unknown[] = asOfDate != null ? [`%${surname}%`, asOfDate] : [`%${surname}%`];
    const nameRes = await pool.query<NameRow>(`
      SELECT pid, pname, COUNT(*) AS cnt FROM (
        SELECT player1_id AS pid, player1_name AS pname
        FROM historical_matches
        WHERE player1_name ILIKE $1
          ${nameSearchDateCond}
        UNION ALL
        SELECT player2_id AS pid, player2_name AS pname
        FROM historical_matches
        WHERE player2_name ILIKE $1
          ${nameSearchDateCond}
      ) t
      GROUP BY pid, pname
      ORDER BY cnt DESC
      LIMIT 10
    `, nameSearchParams);

    // Filter by initial match to avoid collisions (e.g. "Singh" returns both
    // "A. Singh" and "D. Singh" — only keep those whose first char matches)
    const filtered = nameRes.rows.filter(r => {
      const storedFirst = (r.pname ?? "").trim().charAt(0).toUpperCase();
      return storedFirst === firstInitial;
    });

    // Only proceed if exactly one canonical player is found (unambiguous)
    const filteredCanonicals = [...new Set(
      filtered.map(r => canonicalizePlayerId(index, r.pid, r.pname))
    )];

    if (filteredCanonicals.length === 1) {
      const canonical4 = filteredCanonicals[0];
      const aliases4 = getAliasIds(index, canonical4);
      const allIds4 = [...new Set([canonical4, ...aliases4])];
      const asOfIdx4 = asOfDate != null ? allIds4.length + 1 : undefined;
      const res4 = await pool.query<MatchRow>(
        buildHistorySQL(allIds4.length, 1, asOfIdx4),
        asOfDate != null ? [...allIds4, asOfDate] : allIds4,
      );
      if (res4.rows.length > 0) {
        const aliasSet4 = new Set(allIds4);
        return {
          rows: normalizeMatchRowIds(res4.rows, aliasSet4, canonical4),
          resolvedId: canonical4,
          resolvedVia: "db-name-search",
          aliasIds: allIds4,
        };
      }
    }
  }

  // ── Layer 5: live provider fetch ─────────────────────────────────────────
  //
  // Skipped in backfill mode (asOfDate is set) — we never want API calls or
  // quota consumption when scoring historical matches.  A missing player just
  // returns 0 rows, which the scoring engine treats as "player_not_found".
  if (asOfDate != null) {
    return { rows: [], resolvedId: rawId, resolvedVia: "none", aliasIds: [rawId] };
  }

  // All four DB layers returned empty. The player is either absent from the
  // local cache or stored under an ID/name the index cannot cross-reference.
  // Query external providers directly using the submitted player name.
  //
  // On success the provider records are written to historical_matches
  // (non-blocking) so the NEXT request for the same player hits Layer 1.
  const fetchResult = await fetchPlayerMatchesFromProviders(playerName);
  if (fetchResult.records.length > 0 && fetchResult.resolvedPlayerId) {
    const rows = matchRecordsToRows(fetchResult.records, fetchResult.resolvedPlayerId);
    return {
      rows,
      resolvedId: fetchResult.resolvedPlayerId,
      resolvedVia: "provider-fetch",
      aliasIds: [fetchResult.resolvedPlayerId],
      liveFetchDiagnostics: fetchResult.diagnostics,
    };
  }

  // ── No data found after all 5 layers ─────────────────────────────────────
  return {
    rows: [],
    resolvedId: rawId,
    resolvedVia: "none",
    aliasIds: [rawId],
    liveFetchDiagnostics: fetchResult.diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Player statistics (computed directly from historical_matches rows)
// ---------------------------------------------------------------------------

interface PlayerStats {
  total: number;
  winRate: number;
  surfaceTotal: number;
  surfaceWinRate: number;
  recentWinRate: number;     // last 10 matches
  avgOppRank: number;        // SOS proxy (lower avg rank = tougher schedule)
  surfaceAvgOppRank: number;
  retirementRate: number;    // times player retired / total
  lastMatchDate: Date | null;
  currentRank: number | null;
  tournamentWinRate: number;
  tournamentTotal: number;
  quarterWinRates: number[]; // for consistency calculation
}

function computePlayerStats(
  matches: MatchRow[],
  playerId: string,
  surface: string | null,
  tournamentName: string | null,
): PlayerStats {
  const total = matches.length;
  const wins = matches.filter(m => m.winner_id === playerId).length;
  const winRate = total > 0 ? wins / total : 0.5;

  const surfaceKey = surface?.toLowerCase() ?? null;
  const surfaceMatches = surfaceKey
    ? matches.filter(m => m.surface?.toLowerCase() === surfaceKey)
    : [];
  const surfaceWins = surfaceMatches.filter(m => m.winner_id === playerId).length;

  const recent10 = matches.slice(0, 10);
  const recent10Wins = recent10.filter(m => m.winner_id === playerId).length;

  // Avg opponent rank (strength of schedule)
  const getOppRank = (m: MatchRow) =>
    m.player1_id === playerId ? m.player2_rank : m.player1_rank;

  const rankedMatches = matches.filter(m => getOppRank(m) != null && (getOppRank(m) ?? 0) > 0);
  const avgOppRank = rankedMatches.length > 0
    ? rankedMatches.reduce((s, m) => s + (getOppRank(m) ?? 200), 0) / rankedMatches.length
    : 200;

  const surfaceRanked = surfaceMatches.filter(m => getOppRank(m) != null && (getOppRank(m) ?? 0) > 0);
  const surfaceAvgOppRank = surfaceRanked.length > 0
    ? surfaceRanked.reduce((s, m) => s + (getOppRank(m) ?? 200), 0) / surfaceRanked.length
    : avgOppRank;

  // Retirement rate (only when the player lost via retirement — opponent retired doesn't count)
  const retiredLosses = matches.filter(m => m.retired && m.winner_id !== playerId).length;
  const retirementRate = total > 0 ? retiredLosses / total : 0;

  const lastMatchDate = matches.length > 0 ? matches[0].scheduled_start_at : null;

  // Current rank: from most recent match
  const currentRank = matches.length > 0
    ? (matches[0].player1_id === playerId ? matches[0].player1_rank : matches[0].player2_rank)
    : null;

  // Tournament experience
  const tName = tournamentName?.toLowerCase().slice(0, 8) ?? null;
  const tournamentMatches = tName
    ? matches.filter(m => m.tournament_name?.toLowerCase().includes(tName))
    : [];
  const tournamentWins = tournamentMatches.filter(m => m.winner_id === playerId).length;

  // Win rates by quarter (for consistency)
  const qSize = Math.max(1, Math.floor(total / 4));
  const quarterWinRates: number[] = [];
  for (let i = 0; i < 4 && i * qSize < total; i++) {
    const chunk = matches.slice(i * qSize, (i + 1) * qSize);
    if (chunk.length >= 3) {
      quarterWinRates.push(chunk.filter(m => m.winner_id === playerId).length / chunk.length);
    }
  }

  return {
    total, winRate,
    surfaceTotal: surfaceMatches.length, surfaceWinRate: surfaceMatches.length > 0 ? surfaceWins / surfaceMatches.length : 0.5,
    recentWinRate: recent10.length > 0 ? recent10Wins / recent10.length : 0.5,
    avgOppRank, surfaceAvgOppRank,
    retirementRate, lastMatchDate, currentRank,
    tournamentWinRate: tournamentMatches.length > 0 ? tournamentWins / tournamentMatches.length : 0.5,
    tournamentTotal: tournamentMatches.length,
    quarterWinRates,
  };
}

// ---------------------------------------------------------------------------
// Grade assignment
// ---------------------------------------------------------------------------

function toReliabilityGrade(validationScore: number, coverage: number): "A" | "B" | "C" | "D" | "F" {
  // Coverage caps the maximum reliability grade (spec: Validation=92, Coverage=35% → NOT grade A)
  const coverageCap: "A" | "B" | "C" | "D" | "F" =
    coverage >= 80 ? "A" :
    coverage >= 65 ? "B" :
    coverage >= 50 ? "C" :
    coverage >= 35 ? "D" : "F";

  const scoreGrade: "A" | "B" | "C" | "D" | "F" =
    validationScore >= 76 ? "A" :
    validationScore >= 63 ? "B" :
    validationScore >= 50 ? "C" :
    validationScore >= 38 ? "D" : "F";

  const ORDER = ["F", "D", "C", "B", "A"] as const;
  return ORDER[Math.min(ORDER.indexOf(coverageCap), ORDER.indexOf(scoreGrade))];
}

function toParlayGrade(validationScore: number, riskScore: number, grade: string): "Elite" | "Strong" | "Moderate" | "Weak" | "Reject" {
  const adj = validationScore - riskScore * 0.35;
  if (adj >= 52 && grade <= "B") return "Elite";
  if (adj >= 43 && grade <= "C") return "Strong";
  if (adj >= 34) return "Moderate";
  if (adj >= 22) return "Weak";
  return "Reject";
}

function toDecision(
  validationScore: number,
  riskScore: number,
  grade: string,
  coverage: number,
  criticalFlags: string[],
): "KEEP" | "BORDERLINE" | "REMOVE" {
  const hasCritical = criticalFlags.some(f =>
    f.includes("injury") || f.includes("retirement") || f.includes("market disagreement") ||
    f.includes("stale data") || f.includes("No match history")
  );

  if (grade === "F" || validationScore <= 33 || riskScore >= 70) return "REMOVE";
  if (hasCritical || coverage < 40) return "BORDERLINE";
  if (validationScore >= 58 && riskScore <= 44 && grade !== "D" && coverage >= 50) return "KEEP";
  return "BORDERLINE";
}

// ---------------------------------------------------------------------------
// Reason generation (evidence-based, non-generic)
// ---------------------------------------------------------------------------

function generateReasons(factors: FactorScore[], sel: PlayerStats, opp: PlayerStats, surface: string | null): string[] {
  const reasons: string[] = [];

  // Sort available factors by magnitude of deviation from neutral (strongest signal first)
  const available = factors
    .filter(f => f.status !== "unavailable" && f.detail)
    .sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));

  for (const f of available) {
    if (f.detail && !reasons.includes(f.detail)) {
      reasons.push(f.detail);
    }
    if (reasons.length >= 5) break;
  }

  // Always have at least 3
  if (reasons.length < 3) {
    if (sel.total < 10) reasons.push("Limited match history available — validation confidence is reduced");
    if (surface && sel.surfaceTotal < 5) reasons.push(`Fewer than 5 ${surface} matches on record — surface analysis is limited`);
    if (reasons.length < 3) reasons.push("Insufficient historical data to make a high-confidence validation assessment");
  }

  return reasons.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function computeBuilderScore(snapshot: BuilderSnapshot): Promise<BuilderResult> {
  const { selectedPlayerId, selectedPlayerName, opponentId, opponentName, surface, tournamentName, marketOdds, asOfDate } = snapshot;

  // ── 1. Resolve both players' match history with multi-source fallback ────────
  //
  // The identity index + alias expansion + name search ensure that even when
  // the fixture's player_key differs from what's stored in historical_matches
  // (different provider namespace, abbreviated name, fragmented ID), we still
  // find the player's matches rather than returning an empty result set.
  //
  // Each layer is tried in order; the first one that returns rows wins:
  //   1. Direct ID exact match
  //   2. Identity-index canonical ID + all provider aliases  (IN clause)
  //   3. Name resolution via identity index                  (IN clause)
  //   4. Direct DB surname ILIKE search + initial filter
  //   5. Live provider fetch (skipped when asOfDate is set — backfill mode)
  const index = await getCachedPlayerIdentityIndex();

  // Resolve both players + kick off Tier 5 web research in parallel.
  // Web research is skipped in backfill mode (asOfDate set) — historical
  // injury news is unreliable and we never want API calls on backfill rows.
  const [selResolution, oppResolution, webResearch] = await Promise.all([
    resolvePlayerMatchRows(selectedPlayerId, selectedPlayerName, index, asOfDate),
    resolvePlayerMatchRows(opponentId, opponentName, index, asOfDate),
    asOfDate == null
      ? researchPlayerMatchup(selectedPlayerName, opponentName).catch(() => null)
      : Promise.resolve(null),
  ]);

  const selResolvedId = selResolution.resolvedId;
  const oppResolvedId = oppResolution.resolvedId;
  const selMatches = selResolution.rows;
  const oppMatches = oppResolution.rows;

  // Matchstat enrichment — scraped aggregate surface/form data from matchstat.com.
  // Only attempted in live mode (not backfill) when a player has sparse match history.
  // Feeds surfaceAdvantage and recentForm factor fallbacks below.
  const MIN_FOR_MATCHSTAT = 5;
  const needsMatchstat =
    asOfDate == null &&
    (selMatches.length < MIN_FOR_MATCHSTAT || oppMatches.length < MIN_FOR_MATCHSTAT);
  const [selMatchstat, oppMatchstat]: [MatchstatPlayerData | null, MatchstatPlayerData | null] =
    needsMatchstat
      ? await Promise.all([
          scrapeMatchstatPlayer(selectedPlayerName).catch(() => null),
          scrapeMatchstatPlayer(opponentName).catch(() => null),
        ])
      : [null, null];

  // H2H: query using all known alias IDs for both players so we catch cross-
  // provider match records where one player is stored under a different key.
  const selH2hIds = selResolution.aliasIds;
  const oppH2hIds = oppResolution.aliasIds;
  const h2hParams = [...selH2hIds, ...oppH2hIds];
  const s = selH2hIds.length;
  const o = oppH2hIds.length;
  const selIN = selH2hIds.map((_, i) => `$${i + 1}`).join(", ");
  const oppIN = oppH2hIds.map((_, i) => `$${s + i + 1}`).join(", ");

  // In backfill mode exclude H2H matches on or after the target match date.
  const h2hDateParamIdx = asOfDate != null ? h2hParams.length + 1 : null;
  const h2hQueryParams: unknown[] = asOfDate != null ? [...h2hParams, asOfDate] : h2hParams;
  const h2hDateCond = h2hDateParamIdx != null ? `AND scheduled_start_at < $${h2hDateParamIdx}` : "";

  const h2hRawRes = await pool.query<MatchRow>(`
    SELECT player1_id, player2_id, winner_id, player1_rank, player2_rank,
           surface, tournament_name, scheduled_start_at, retired, walkover
    FROM historical_matches
    WHERE ((player1_id IN (${selIN}) AND player2_id IN (${oppIN}))
        OR (player1_id IN (${oppIN}) AND player2_id IN (${selIN})))
      AND (cancelled IS NULL OR cancelled = false)
      ${h2hDateCond}
    ORDER BY scheduled_start_at DESC
    LIMIT 15
  `, h2hQueryParams);

  // Normalise H2H winner_id so the H2H factor can check m.winner_id === selResolvedId
  const selAliasSet = new Set(selH2hIds);
  const oppAliasSet = new Set(oppH2hIds);
  const h2hMatches = h2hRawRes.rows.map(r => ({
    ...r,
    winner_id: r.winner_id == null ? null
      : selAliasSet.has(r.winner_id) ? selResolvedId
      : oppAliasSet.has(r.winner_id) ? oppResolvedId
      : r.winner_id,
  }));

  // ── Provider-outage guard ────────────────────────────────────────────────
  // If a player is absent from the local DB AND the provider was unreachable,
  // we have no real evidence at all. Computing a Grade D from zero matches
  // would be actively misleading — return DATA_UNAVAILABLE instead.
  const selIsOutage = selMatches.length === 0 &&
    selResolution.liveFetchDiagnostics?.outcome === "SOURCE_UNAVAILABLE";
  const oppIsOutage = oppMatches.length === 0 &&
    oppResolution.liveFetchDiagnostics?.outcome === "SOURCE_UNAVAILABLE";

  if (selIsOutage || oppIsOutage) {
    const outagePlayers = [
      ...(selIsOutage ? [selectedPlayerName] : []),
      ...(oppIsOutage ? [opponentName] : []),
    ];
    const reasons = selResolution.liveFetchDiagnostics?.failureReasons.length
      ? selResolution.liveFetchDiagnostics.failureReasons
      : oppResolution.liveFetchDiagnostics?.failureReasons ?? [];
    const dataSourceDiagnostics: DataSourceDiagnostics = {
      selectedPlayerStatus: "player_not_found",
      opponentStatus: "player_not_found",
      selectedPlayerMatchCount: 0,
      opponentMatchCount: 0,
      h2hMatchCount: 0,
      isProviderOutage: true,
      selectedPlayerProviderDiag: selResolution.liveFetchDiagnostics,
      opponentProviderDiag: oppResolution.liveFetchDiagnostics,
      dataConfidenceNote: `External data providers could not be reached for ${outagePlayers.join(" and ")}. Validation is unavailable — try again when providers are online.`,
    };
    return {
      validationScore: 0,
      riskScore: 0,
      reliabilityGrade: "F",
      parlayGrade: "Reject",
      removalProbability: 0,
      decision: "DATA_UNAVAILABLE",
      reasons: reasons.length > 0 ? reasons : ["All configured data providers were unreachable. No evidence could be gathered for this validation."],
      criticalFlags: [`Data unavailable — providers unreachable for: ${outagePlayers.join(", ")}`],
      dataCoverage: 0,
      sourceAgreement: 0,
      sourcesAgreeing: 0,
      sourcesTotal: 0,
      factorScores: [],
      dataSourceDiagnostics,
      builderVersion: BUILDER_VERSION,
    };
  }

  const sel = computePlayerStats(selMatches, selResolvedId, surface, tournamentName);
  const opp = computePlayerStats(oppMatches, oppResolvedId, surface, tournamentName);

  // ── 2. Compute factor scores ──────────────────────────────────────────────

  const factors: FactorScore[] = [];

  function addFactor(
    key: string,
    label: string,
    score: number,
    detail: string,
    limited = false,
  ): void {
    const status = limited ? "limited" : "available";
    factors.push({
      key, label, score,
      weight: DEFAULT_WEIGHTS[key] ?? 0.01,
      status,
      supportsSelected: score > 52 ? true : score < 48 ? false : null,
      detail,
    });
  }

  function addUnavailable(key: string, label: string): void {
    factors.push({
      key, label, score: 50,
      weight: DEFAULT_WEIGHTS[key] ?? 0.01,
      status: "unavailable",
      supportsSelected: null,
      detail: "",
    });
  }

  // Factor: Overall Advantage (rank-adjusted win rate, proxy for Elo)
  if (sel.total >= 5 && opp.total >= 5) {
    // Rank-adjust: lower avg opp rank (harder SOS) boosts win rate
    const sosBoostSel = sel.avgOppRank < 80 ? 0.04 : sel.avgOppRank < 150 ? 0.02 : 0;
    const sosBoostOpp = opp.avgOppRank < 80 ? 0.04 : opp.avgOppRank < 150 ? 0.02 : 0;
    const adjSel = sel.winRate + sosBoostSel;
    const adjOpp = opp.winRate + sosBoostOpp;
    const score = diffScore(adjSel, adjOpp, 100);
    const pctSel = Math.round(sel.winRate * 100);
    const pctOpp = Math.round(opp.winRate * 100);
    const adv = score > 55 ? "advantage" : score < 45 ? "disadvantage" : "neutral";
    addFactor("overallAdvantage", "Overall Win Rate",
      score,
      `Overall win rate: ${selectedPlayerName} ${pctSel}% vs ${opponentName} ${pctOpp}% — ${adv} based on ${sel.total + opp.total} total matches`
    );
  } else {
    addFactor("overallAdvantage", "Overall Win Rate", 50,
      `Insufficient match history (${selectedPlayerName}: ${sel.total}, ${opponentName}: ${opp.total} matches)`, true);
  }

  // Factor: Surface Advantage
  if (surface && sel.surfaceTotal >= 3 && opp.surfaceTotal >= 3) {
    const score = diffScore(sel.surfaceWinRate, opp.surfaceWinRate, 100);
    const pctSel = Math.round(sel.surfaceWinRate * 100);
    const pctOpp = Math.round(opp.surfaceWinRate * 100);
    const label = score > 55 ? "favors" : score < 45 ? "favors opponent on" : "neutral on";
    addFactor("surfaceAdvantage", `${surface} Court Advantage`,
      score,
      `${surface} court record: ${selectedPlayerName} ${pctSel}% (${sel.surfaceTotal} matches) vs ${opponentName} ${pctOpp}% (${opp.surfaceTotal} matches) — ${label} ${surface}`
    );
  } else {
    const limited = (surface && (sel.surfaceTotal < 3 || opp.surfaceTotal < 3));
    // Matchstat enrichment fallback — use scraped surface records when raw data is sparse
    const selMs = surface ? selMatchstat?.surfaceRecords[surface as keyof typeof selMatchstat.surfaceRecords] : null;
    const oppMs = surface ? oppMatchstat?.surfaceRecords[surface as keyof typeof oppMatchstat.surfaceRecords] : null;
    if (surface && selMs && oppMs && (selMs.wins + selMs.losses) >= 2 && (oppMs.wins + oppMs.losses) >= 2) {
      const selMsRate = selMs.wins / (selMs.wins + selMs.losses);
      const oppMsRate = oppMs.wins / (oppMs.wins + oppMs.losses);
      const msScore = diffScore(selMsRate, oppMsRate, 100);
      addFactor("surfaceAdvantage", `${surface} Court Advantage`,
        msScore,
        `${surface} record (Matchstat): ${selectedPlayerName} ${selMs.wins}-${selMs.losses} vs ${opponentName} ${oppMs.wins}-${oppMs.losses}`,
        true
      );
    } else {
      addFactor("surfaceAdvantage", `${surface ?? "Surface"} Advantage`, 50,
        `${limited ? `Limited ${surface} court data (${selectedPlayerName}: ${sel.surfaceTotal}, ${opponentName}: ${opp.surfaceTotal})` : "No surface specified"}`, !!limited);
    }
  }

  // Factor: UTR (unavailable)
  addUnavailable("utr", "UTR Rating");

  // Factor: Recent Form (last 10 matches)
  const recentScore = diffScore(sel.recentWinRate, opp.recentWinRate, 100);
  if (sel.recentWinRate > 0.5 || opp.recentWinRate > 0.5) {
    const selR = Math.round(sel.recentWinRate * 10);
    const oppR = Math.round(opp.recentWinRate * 10);
    addFactor("recentForm", "Recent Form",
      recentScore,
      `Recent form (last 10): ${selectedPlayerName} ${selR}/10 wins vs ${opponentName} ${oppR}/10 wins`
    );
  } else {
    // Matchstat enrichment fallback — use scraped recent record when match history is sparse
    const selMsR = selMatchstat?.recentRecord;
    const oppMsR = oppMatchstat?.recentRecord;
    if (selMsR && oppMsR && (selMsR.wins + selMsR.losses) >= 3 && (oppMsR.wins + oppMsR.losses) >= 3) {
      const selMsRate = selMsR.wins / (selMsR.wins + selMsR.losses);
      const oppMsRate = oppMsR.wins / (oppMsR.wins + oppMsR.losses);
      const msScore = diffScore(selMsRate, oppMsRate, 100);
      addFactor("recentForm", "Recent Form",
        msScore,
        `Recent form (Matchstat): ${selectedPlayerName} ${selMsR.wins}-${selMsR.losses} vs ${opponentName} ${oppMsR.wins}-${oppMsR.losses}`,
        true
      );
    } else {
      addFactor("recentForm", "Recent Form", 50, "Recent match history insufficient for form analysis", true);
    }
  }

  // Factor: Surface Record (broader surface performance)
  if (surface && (sel.surfaceTotal >= 5 || opp.surfaceTotal >= 5)) {
    const score = diffScore(sel.surfaceWinRate, opp.surfaceWinRate, 80);
    addFactor("surfaceRecord", `${surface} Surface Record`, score,
      `${surface} overall record supports ${score > 52 ? selectedPlayerName : score < 48 ? opponentName : "neither player"}`
    );
  } else {
    addFactor("surfaceRecord", "Surface Record", 50, "Insufficient surface data", true);
  }

  // Factors: Serve, Return, Hold/Break — no data
  addUnavailable("serveAdvantage", "Serve Advantage");
  addUnavailable("returnAdvantage", "Return Advantage");
  addUnavailable("holdBreak", "Hold/Break Statistics");

  // Factor: Strength of Schedule
  if (sel.total >= 10 && opp.total >= 10) {
    // Better SOS + higher win rate = more impressive record
    // If both beat top opponents at similar rates, the one who beat harder opponents is favored
    const selSOS = sel.avgOppRank > 0 ? 1 / sel.avgOppRank : 0;  // lower rank = harder = higher value
    const oppSOS = opp.avgOppRank > 0 ? 1 / opp.avgOppRank : 0;
    // Combine: if selected beats tougher opponents, that's positive
    const selAdj = sel.winRate * (1 + selSOS * 100);
    const oppAdj = opp.winRate * (1 + oppSOS * 100);
    const score = diffScore(selAdj, oppAdj, 30);
    addFactor("strengthOfSchedule", "Strength of Schedule",
      score,
      `Avg opponent ranking: ${selectedPlayerName} ${Math.round(sel.avgOppRank)} vs ${opponentName} ${Math.round(opp.avgOppRank)}`
    );
  } else {
    addFactor("strengthOfSchedule", "Strength of Schedule", 50, "Insufficient data for schedule analysis", true);
  }

  // Factor: Market Consensus
  if (marketOdds != null && marketOdds > 1) {
    const impliedProb = 1 / marketOdds;
    const score = Math.round(50 + clamp((impliedProb - 0.5) * 100, -50, 50));
    const pct = Math.round(impliedProb * 100);
    const direction = impliedProb > 0.55 ? "supports" : impliedProb < 0.45 ? "disagrees with" : "is neutral on";
    addFactor("marketConsensus", "Market Consensus",
      score,
      `Betting market implies ${pct}% probability — market ${direction} this selection (odds ${marketOdds})`
    );
  } else {
    addFactor("marketConsensus", "Market Consensus", 50, "No market odds provided", true);
  }

  // Factor: Ranking Trend (current rank vs recent form trend)
  const selRank = sel.currentRank;
  const oppRank = opp.currentRank;
  if (selRank != null && oppRank != null) {
    // Lower rank number = better ranked; score inverts
    const score = diffScore(oppRank, selRank, 0.5);
    addFactor("rankingTrend", "Current Ranking",
      score,
      `Rankings: ${selectedPlayerName} #${selRank} vs ${opponentName} #${oppRank} — ${score > 52 ? `${selectedPlayerName} is higher-ranked` : score < 48 ? `${opponentName} is higher-ranked` : "similar rankings"}`
    );
  } else if (selRank != null || oppRank != null) {
    const known = selRank != null ? selectedPlayerName : opponentName;
    addFactor("rankingTrend", "Current Ranking", 50, `Ranking only available for ${known}`, true);
  } else {
    addFactor("rankingTrend", "Current Ranking", 50, "No ranking data available in recent matches", true);
  }

  // Factor: Head-to-Head
  if (h2hMatches.length >= 2) {
    const h2hWins = h2hMatches.filter(m => m.winner_id === selResolvedId).length;
    const h2hTotal = h2hMatches.length;
    const h2hRate = h2hWins / h2hTotal;
    // Recency weight: more recent matches count more
    const recentH2h = h2hMatches.slice(0, 5);
    const recentWins = recentH2h.filter(m => m.winner_id === selResolvedId).length;
    const blended = (h2hRate * 0.4 + (recentWins / recentH2h.length) * 0.6);
    const score = diffScore(blended, 1 - blended, 80);
    addFactor("headToHead", "Head-to-Head",
      score,
      `H2H record: ${selectedPlayerName} ${h2hWins}–${h2hTotal - h2hWins} vs ${opponentName} (last ${h2hTotal} meetings)`
    );
  } else if (h2hMatches.length === 1) {
    const won = h2hMatches[0].winner_id === selResolvedId;
    addFactor("headToHead", "Head-to-Head",
      won ? 58 : 42,
      `Only 1 H2H meeting found — ${selectedPlayerName} ${won ? "won" : "lost"} that match`, true);
  } else {
    addFactor("headToHead", "Head-to-Head", 50, "No previous meetings on record", true);
  }

  // Factor: Travel / Fatigue
  const selDaysRest = sel.lastMatchDate
    ? Math.floor((Date.now() - sel.lastMatchDate.getTime()) / 86_400_000)
    : null;
  const oppDaysRest = opp.lastMatchDate
    ? Math.floor((Date.now() - opp.lastMatchDate.getTime()) / 86_400_000)
    : null;
  if (selDaysRest != null && oppDaysRest != null) {
    // 1-3 days rest = ideal, <1 = fatigued, >14 = rust concern
    const restScore = (d: number) => d < 1 ? 0.3 : d === 1 ? 0.7 : d <= 3 ? 1.0 : d <= 7 ? 0.9 : d <= 14 ? 0.7 : 0.5;
    const score = diffScore(restScore(selDaysRest), restScore(oppDaysRest), 60);
    addFactor("travelFatigue", "Rest & Fatigue",
      score,
      `Days since last match: ${selectedPlayerName} ${selDaysRest}d vs ${opponentName} ${oppDaysRest}d`
    );
  } else {
    addFactor("travelFatigue", "Rest & Fatigue", 50, "Match schedule data unavailable", true);
  }

  // Factor: Injury Risk — Tier 5 web research via Gemini Google Search grounding.
  // Skipped in backfill mode (webResearch is null when asOfDate is set).
  if (webResearch && webResearch.confidence >= 0.3) {
    const selFit = 100 - webResearch.selected.riskLevel;
    const oppFit = 100 - webResearch.opponent.riskLevel;
    const score = Math.round(clamp(50 + (selFit - oppFit) * 0.35, 20, 80));
    const parts: string[] = [];
    if (webResearch.selected.injuryStatus !== "unknown" && webResearch.selected.injuryStatus !== "fit") {
      parts.push(`${selectedPlayerName}: ${webResearch.selected.injuryDetail ?? webResearch.selected.injuryStatus}`);
    }
    if (webResearch.opponent.injuryStatus !== "unknown" && webResearch.opponent.injuryStatus !== "fit") {
      parts.push(`${opponentName}: ${webResearch.opponent.injuryDetail ?? webResearch.opponent.injuryStatus}`);
    }
    if (parts.length === 0) {
      parts.push(
        `No active injury concerns found — ${selectedPlayerName} risk: ${webResearch.selected.riskLevel}/100, ${opponentName} risk: ${webResearch.opponent.riskLevel}/100`,
      );
    }
    addFactor(
      "injuryRisk",
      "Injury & Fitness Risk",
      score,
      parts.join("; "),
      webResearch.confidence < 0.6,
    );
  } else {
    addFactor(
      "injuryRisk",
      "Injury & Fitness Risk",
      50,
      "No real-time injury data — web research returned no results or low confidence",
      true,
    );
  }

  // Factor: Tournament Experience
  if (tournamentName && (sel.tournamentTotal >= 2 || opp.tournamentTotal >= 2)) {
    const score = diffScore(
      sel.tournamentTotal > 0 ? sel.tournamentWinRate : 0.5,
      opp.tournamentTotal > 0 ? opp.tournamentWinRate : 0.5,
      80
    );
    addFactor("tournamentExperience", "Tournament Experience",
      score,
      `${tournamentName} experience: ${selectedPlayerName} ${sel.tournamentWinRate > 0 ? `${Math.round(sel.tournamentWinRate * 100)}% (${sel.tournamentTotal} matches)` : "no prior data"} vs ${opponentName} ${opp.tournamentTotal > 0 ? `${Math.round(opp.tournamentWinRate * 100)}% (${opp.tournamentTotal} matches)` : "no prior data"}`
    );
  } else {
    addFactor("tournamentExperience", "Tournament Experience", 50,
      tournamentName ? "Insufficient tournament history" : "No tournament specified", true);
  }

  // Factor: Historical Consistency (lower stddev in quarterly win rates = more consistent)
  const selStd = stddev(sel.quarterWinRates);
  const oppStd = stddev(opp.quarterWinRates);
  if (sel.quarterWinRates.length >= 2 && opp.quarterWinRates.length >= 2) {
    // Lower stddev = more consistent = favored (inverse relationship)
    const score = diffScore(oppStd, selStd, 150);
    addFactor("historicalConsistency", "Historical Consistency",
      score,
      `Performance consistency: ${selectedPlayerName} ${score > 52 ? "more consistent" : score < 48 ? "less consistent" : "similar"} to ${opponentName} over the past 2 years`
    );
  } else {
    addFactor("historicalConsistency", "Historical Consistency", 50, "Insufficient history for consistency analysis", true);
  }

  // Factor: Historical Volatility (retirement/walkover rate)
  if (sel.total >= 10 && opp.total >= 10) {
    // Lower retirement rate = lower volatility = favored
    const score = diffScore(opp.retirementRate, sel.retirementRate, 200);
    const selPct = Math.round(sel.retirementRate * 100);
    const oppPct = Math.round(opp.retirementRate * 100);
    addFactor("historicalVolatility", "Historical Volatility",
      score,
      `Retirement rate: ${selectedPlayerName} ${selPct}% vs ${opponentName} ${oppPct}% — ${score > 52 ? `${selectedPlayerName} has lower volatility` : score < 48 ? `${opponentName} is more reliable` : "similar retirement history"}`
    );
  } else {
    addFactor("historicalVolatility", "Historical Volatility", 50, "Insufficient data for volatility analysis", true);
  }

  // Factor: Data Quality (% of expected matches available)
  const expectedMatches = 30;
  const selCoverage = Math.min(100, Math.round((sel.total / expectedMatches) * 100));
  const oppCoverage = Math.min(100, Math.round((opp.total / expectedMatches) * 100));
  const avgDataCoverage = (selCoverage + oppCoverage) / 2;
  const dqScore = clamp(Math.round(avgDataCoverage * 0.5 + 50 - 25), 20, 80);
  addFactor("dataQuality", "Data Coverage Quality",
    dqScore,
    `Data coverage: ${selectedPlayerName} ${selCoverage}%, ${opponentName} ${oppCoverage}% of expected match history available`
  );

  // ── 3. Source Agreement (computed after all other factors) ────────────────
  //
  // IMPORTANT: only count factors that actively took a side (supportsSelected !== null).
  // Neutral factors (score ≈ 50, supportsSelected = null) are legitimately undecided —
  // including them in the denominator would make 0/13 appear when actually 0 factors had
  // enough data to form an opinion. The displayed "X of Y sources agree" should mean
  // "X of the Y factors that could take a side agree", not "X of all factors".

  const decisiveFacters = factors.filter(f => f.status !== "unavailable" && f.key !== "sourceAgreement");
  // Only opinionated factors (those that actually support or oppose) count in agreement math
  const opinionatedFactors = decisiveFacters.filter(f => f.supportsSelected !== null);
  const agreeing = opinionatedFactors.filter(f => f.supportsSelected === true).length;
  const available = opinionatedFactors.length;
  const agreementRate = available > 0 ? agreeing / available : 0.5;
  const agreementScore = Math.round(agreementRate * 100);
  const saFactor: FactorScore = {
    key: "sourceAgreement",
    label: "Source Agreement",
    score: diffScore(agreementRate, 1 - agreementRate, 100),
    weight: DEFAULT_WEIGHTS.sourceAgreement,
    status: "available",
    supportsSelected: agreementRate > 0.55 ? true : agreementRate < 0.45 ? false : null,
    detail: `${agreeing} of ${available} available sources agree with this selection (${agreementScore}% agreement)`,
  };
  factors.push(saFactor);

  // ── 4. Compute Validation Score (weighted avg of available factors) ────────

  const availFactors = factors.filter(f => f.status !== "unavailable");
  const totalAvailWeight = availFactors.reduce((s, f) => s + f.weight, 0);
  const validationScore = Math.round(
    availFactors.reduce((s, f) => s + f.score * (f.weight / totalAvailWeight), 0)
  );

  // Coverage % = proportion of spec weight that has real data
  const unavailWeight = factors.filter(f => f.status === "unavailable").reduce((s, f) => s + f.weight, 0);
  const dataCoverage = Math.round((1 - unavailWeight) * 100);

  // ── 5. Risk Score (independent calculation) ───────────────────────────────

  let risk = 35; // baseline

  // Raise risk for negative signals
  if (sel.recentWinRate < 0.4) risk += 12;
  if (surface && sel.surfaceWinRate < 0.4 && sel.surfaceTotal >= 5) risk += 10;
  if (marketOdds != null && 1 / marketOdds < 0.42) risk += 18;
  if (selDaysRest != null && selDaysRest <= 1) risk += 10;
  if (sel.retirementRate > 0.12) risk += 8;
  if (opp.recentWinRate > 0.7) risk += 8;
  if (sel.total < 10) risk += 12;  // insufficient data = more risk
  if (dataCoverage < 60) risk += 10;

  // Lower risk for positive signals
  if (sel.winRate > 0.65 && sel.total >= 15) risk -= 10;
  if (surface && sel.surfaceWinRate > 0.65 && sel.surfaceTotal >= 8) risk -= 10;
  if (agreementRate > 0.75) risk -= 8;
  if (marketOdds != null && 1 / marketOdds > 0.60) risk -= 12;
  if (selRank != null && oppRank != null && selRank < oppRank * 0.5) risk -= 8;

  const riskScore = clamp(Math.round(risk), 0, 100);

  // ── 6. Critical flags & data source diagnostics ──────────────────────────────
  //
  // Three distinct states that must NOT be conflated:
  //   player_not_found  — 0 DB rows; ID mismatch or player has no professional record
  //   insufficient_data — 1–4 rows; player IS in DB but with minimal history
  //   data_available    — ≥5 rows; enough to compute real factor scores
  //
  // "I don't know" (player_not_found) ≠ "this is a bad bet" (negative score).

  const toPlayerStatus = (total: number): PlayerDataStatus =>
    total === 0 ? "player_not_found" : total < 5 ? "insufficient_data" : "data_available";

  const dataSourceDiagnostics: DataSourceDiagnostics = {
    selectedPlayerStatus: toPlayerStatus(sel.total),
    opponentStatus: toPlayerStatus(opp.total),
    selectedPlayerMatchCount: sel.total,
    opponentMatchCount: opp.total,
    h2hMatchCount: h2hMatches.length,
    selectedPlayerResolvedVia: selResolution.resolvedVia !== "direct" ? selResolution.resolvedVia : undefined,
    opponentResolvedVia: oppResolution.resolvedVia !== "direct" ? oppResolution.resolvedVia : undefined,
    // Include live-fetch diagnostics when the DB had no data and providers were tried
    selectedPlayerProviderDiag: selResolution.liveFetchDiagnostics,
    opponentProviderDiag: oppResolution.liveFetchDiagnostics,
  };

  const criticalFlags: string[] = [];

  // Helper: build a provider-aware "not found" message based on what the
  // live fetch actually reported (no provider called at all vs. called but
  // returned nothing vs. searched but player not recognised).
  const notFoundMessage = (name: string, diag?: LiveFetchDiagnostics): string => {
    if (!diag || diag.outcome === "CACHE_MISS") {
      return `No match history found for ${name} in any configured source`;
    }
    if (diag.outcome === "PLAYER_NOT_FOUND") {
      return `${name} was not recognised by ${diag.sourcesAttempted.join(", ")} — name may differ in provider records`;
    }
    if (diag.outcome === "NO_MATCH_HISTORY") {
      return `${name} was found in ${diag.sourcesSuccessful.join(", ")} but has no completed professional match records`;
    }
    if (diag.outcome === "SOURCE_UNAVAILABLE") {
      return `${name} — provider(s) could not be reached (${diag.sourcesFailed.join(", ")})`;
    }
    return `No match history found for ${name} across all configured sources`;
  };

  if (sel.total === 0) {
    criticalFlags.push(notFoundMessage(selectedPlayerName, selResolution.liveFetchDiagnostics));
    dataSourceDiagnostics.dataConfidenceNote =
      "Match history could not be retrieved from any source. Validation scores are unreliable — verify player name and try again.";
  } else if (sel.total < 5) {
    const source = selResolution.resolvedVia === "provider-fetch" ? " (live provider)" : "";
    criticalFlags.push(`Very limited match history for ${selectedPlayerName} — ${sel.total} match${sel.total !== 1 ? "es" : ""} found${source}`);
  }

  if (opp.total === 0) {
    if (!criticalFlags.some(f => f.includes("No match history") || f.includes("was not recognised") || f.includes("no completed"))) {
      criticalFlags.push(notFoundMessage(opponentName, oppResolution.liveFetchDiagnostics));
    }
    if (!dataSourceDiagnostics.dataConfidenceNote) {
      dataSourceDiagnostics.dataConfidenceNote =
        "Match history could not be retrieved from any source. Validation scores are unreliable — verify player name and try again.";
    }
  } else if (opp.total < 5) {
    const source = oppResolution.resolvedVia === "provider-fetch" ? " (live provider)" : "";
    criticalFlags.push(`Very limited match history for ${opponentName} — ${opp.total} match${opp.total !== 1 ? "es" : ""} found${source}`);
  }

  // Only flag missing surface data when the player IS found (not-found gets its own message)
  if (surface && sel.surfaceTotal === 0 && sel.total > 0) {
    criticalFlags.push(`No ${surface} court matches found for ${selectedPlayerName}`);
  }
  if (marketOdds != null && 1 / marketOdds < 0.38) {
    criticalFlags.push("Large market disagreement — market strongly favors opponent");
  }
  if (selDaysRest != null && selDaysRest === 0) {
    criticalFlags.push(`${selectedPlayerName} may have played today`);
  }

  // ── 7. Grades and decision ────────────────────────────────────────────────

  const reliabilityGrade = toReliabilityGrade(validationScore, dataCoverage);
  const parlayGrade = toParlayGrade(validationScore, riskScore, reliabilityGrade);
  const decision = toDecision(validationScore, riskScore, reliabilityGrade, dataCoverage, criticalFlags);
  const removalProbability = clamp(Math.round((100 - validationScore) * 0.55 + riskScore * 0.45), 0, 100);

  // ── 8. Reasons ────────────────────────────────────────────────────────────

  const reasons = generateReasons(factors, sel, opp, surface);

  return {
    validationScore,
    riskScore,
    reliabilityGrade,
    parlayGrade,
    removalProbability,
    decision,
    reasons,
    criticalFlags,
    dataCoverage,
    sourceAgreement: agreementScore,
    sourcesAgreeing: agreeing,
    sourcesTotal: available,
    factorScores: factors,
    dataSourceDiagnostics,
    builderVersion: BUILDER_VERSION,
  };
}
