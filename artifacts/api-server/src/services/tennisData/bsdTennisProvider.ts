/**
 * BSD Tennis provider (sports.bzzoiro.com/tennis/api/v2/).
 *
 * Used as tier-3 fallback for player match history when both MatchStat and
 * API-Tennis are unavailable. BSD has its own player ID space, so this module
 * resolves a player name → BSD player ID (via a lazy-loaded rankings cache)
 * and then fetches their completed match history.
 *
 * Auth: Authorization: Token $BSD_TENNIS_API_KEY header.
 * No API key → module returns empty results silently (non-fatal).
 */

import { logger } from "../../lib/logger.js";
import type { MatchRecord, Surface, TournamentLevel } from "./types.js";

const BASE_URL = "https://sports.bzzoiro.com";
const TIMEOUT_MS = 10_000;
const MAX_MATCHES_PER_FETCH = 200;

// ─── Response shapes ─────────────────────────────────────────────────────────

interface BsdPlayer {
  id: number;
  name: string;
  short_name: string;
  gender: "M" | "F" | string;
  country_code: string | null;
  current_ranking: { position: number; points: number; type: string } | null;
}

interface BsdRankingEntry {
  id: number;
  player: BsdPlayer;
  ranking_type: "ATP" | "WTA" | string;
  position: number;
}

interface BsdSetDetail {
  p1: number;
  p2: number;
}

interface BsdMatch {
  id: number;
  tournament: {
    id: number;
    name: string;
    circuit: string;
    category: string;
    surface: string | null;
  };
  player1: BsdPlayer;
  player2: BsdPlayer;
  match_date: string;
  status: string;
  round_name: string | null;
  player1_sets: number | null;
  player2_sets: number | null;
  sets_detail: BsdSetDetail[] | null;
  winner_id: number | null;
  odds_player1: number | null;
  odds_player2: number | null;
}

interface BsdPaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getKey(): string | null {
  return process.env.BSD_TENNIS_API_KEY ?? null;
}

function bsdFetch(path: string): Promise<Response> {
  const key = getKey();
  if (!key) throw new Error("BSD_TENNIS_API_KEY not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Token ${key}`,
      Accept: "application/json",
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapSurface(surface: string | null | undefined): Surface | null {
  if (!surface) return null;
  const s = surface.toLowerCase().replace(/[\s_-]/g, "");
  if (s === "clay") return "Clay";
  if (s === "grass") return "Grass";
  if (s === "hard") return "Hard";
  if (s === "indoorhard" || s === "indoor") return "IndoorHard";
  return null;
}

function mapLevel(category: string | null, circuit: string | null): TournamentLevel | null {
  const c = (category ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (c === "grandslam") return "GrandSlam";
  if (c === "masters" || c === "masters1000" || c === "wta1000") {
    return circuit?.toUpperCase() === "WTA" ? "WTA1000" : "Masters1000";
  }
  if (c === "atp500" || c === "wta500" || c === "500") {
    return circuit?.toUpperCase() === "WTA" ? "WTA500" : "ATP500";
  }
  if (c === "atp250" || c === "wta250" || c === "250") {
    return circuit?.toUpperCase() === "WTA" ? "WTA250" : "ATP250";
  }
  if (c === "challenger") return "Challenger";
  if (c === "itf") return "ITF";
  if (c === "utr" || c === "other" || c === "exhibition") return "Other";
  // Fallback: guess from circuit name
  if (circuit?.toUpperCase() === "ATP") return "ATP250";
  if (circuit?.toUpperCase() === "WTA") return "WTA250";
  return "Other";
}

function formatScore(
  setsDetail: BsdSetDetail[] | null,
  playerIsP1: boolean,
): string | null {
  if (!setsDetail || setsDetail.length === 0) return null;
  return setsDetail
    .map((s) => (playerIsP1 ? `${s.p1}-${s.p2}` : `${s.p2}-${s.p1}`))
    .join(" ");
}

function mapMatch(match: BsdMatch, playerId: number): MatchRecord | null {
  if (match.status !== "finished" || match.winner_id == null) return null;

  const playerIsP1 = match.player1.id === playerId;
  const player = playerIsP1 ? match.player1 : match.player2;
  const opponent = playerIsP1 ? match.player2 : match.player1;

  if (player.id !== playerId) return null;

  const won = match.winner_id === playerId;
  const surface = mapSurface(match.tournament.surface);
  const level = mapLevel(match.tournament.category, match.tournament.circuit);
  const score = formatScore(match.sets_detail, playerIsP1);
  const date = match.match_date.slice(0, 10);

  // Games-per-set margins for serve/return proxies
  const setGameMargins: Array<{ playerGames: number; opponentGames: number }> =
    (match.sets_detail ?? []).map((s) => ({
      playerGames: playerIsP1 ? s.p1 : s.p2,
      opponentGames: playerIsP1 ? s.p2 : s.p1,
    }));

  return {
    id: `bsd-${match.id}`,
    date,
    tournamentName: match.tournament.name ?? null,
    tournamentLevel: level,
    round: match.round_name || null,
    matchFormat: null,
    surface,
    indoor: null,
    opponentId: String(opponent.id),
    opponentName: opponent.name,
    opponentRank: opponent.current_ranking?.position ?? null,
    result: won ? "W" : "L",
    score,
    retired: false,
    walkover: false,
    stats: null,
    opponentStats: null,
    setGameMargins,
  };
}

// ─── Rankings cache (name → BSD player ID) ───────────────────────────────────

interface RankingsCache {
  map: Map<string, number>; // normalized name → BSD player ID
  loadedAt: number;
}

const RANKINGS_TTL_MS = 60 * 60 * 1000; // 1 hour
let _rankingsCache: RankingsCache | null = null;

async function loadRankingsPage(
  offset: number,
): Promise<BsdPaginatedResponse<BsdRankingEntry>> {
  const res = await bsdFetch(
    `/tennis/api/v2/rankings/?limit=50&offset=${offset}`,
  );
  if (!res.ok) throw new Error(`BSD rankings HTTP ${res.status}`);
  return (await res.json()) as BsdPaginatedResponse<BsdRankingEntry>;
}

async function getRankingsCache(): Promise<Map<string, number>> {
  const now = Date.now();
  if (_rankingsCache && now - _rankingsCache.loadedAt < RANKINGS_TTL_MS) {
    return _rankingsCache.map;
  }

  const map = new Map<string, number>();
  let offset = 0;
  let total = 0;

  try {
    do {
      const page = await loadRankingsPage(offset);
      total = page.count;
      for (const entry of page.results) {
        const p = entry.player;
        map.set(normalizeName(p.name), p.id);
        if (p.short_name) map.set(normalizeName(p.short_name), p.id);
      }
      offset += page.results.length;
    } while (offset < total && offset < 1000); // Cap at 1000 (ATP+WTA top 500 each)
    logger.debug({ players: map.size }, "BSD Tennis rankings cache loaded");
  } catch (err) {
    logger.warn({ err }, "BSD Tennis: failed to load rankings cache");
  }

  _rankingsCache = { map, loadedAt: now };
  return map;
}

/**
 * Returns true when every significant word (>1 char) from `queryNorm` appears as
 * an **exact whole word** in `candidateNorm`. Used for both the rankings-cache scan
 * and the search-result filter so a shared surname alone cannot silently alias two
 * different players (e.g. "carlos rodriguez" must not match "pablo rodriguez").
 */
function allQueryWordsMatch(queryNorm: string, candidateNorm: string): boolean {
  const qWords = queryNorm.split(" ").filter(w => w.length > 1);
  if (qWords.length === 0) return false;
  const cWordSet = new Set(candidateNorm.split(" "));
  return qWords.every(w => cWordSet.has(w));
}

type BsdResolvedVia = "rankings-cache" | "search-fallback";

/**
 * Attempts a BSD player-search API call for players outside the top-500 rankings cache.
 * BSD exposes GET /tennis/api/v2/players/?search=<term> — queries by surname.
 *
 * Acceptance criteria (both must be met to avoid wrong-player aliasing):
 *  - Every significant query word appears as an **exact whole word** in the candidate name.
 *  - Exactly **one** search result passes this filter (ambiguous results → null).
 *
 * On success, caches both the candidate's own normalized name AND the queried normalized
 * name so the next call for either form hits the fast exact-match path.
 *
 * Returns null — never throws — when the endpoint is unavailable, the result is ambiguous,
 * or no candidate passes the full-name filter.
 */
async function searchBsdPlayerByName(
  normalized: string, // pre-normalized queried name
  cache: Map<string, number>,
): Promise<number | null> {
  const words = normalized.split(" ");
  // Use the surname (last word) as the search term for maximum recall.
  const surname = words[words.length - 1] ?? "";
  if (surname.length < 3) return null;

  let res: Response;
  try {
    res = await bsdFetch(`/tennis/api/v2/players/?search=${encodeURIComponent(surname)}`);
  } catch {
    return null; // network / timeout / AbortError — non-fatal
  }

  if (!res.ok) {
    // 404 or 405 means the endpoint doesn't exist on this BSD plan — non-fatal.
    logger.debug({ surname, status: res.status }, "BSD Tennis player-search endpoint unavailable (non-fatal)");
    return null;
  }

  let data: BsdPaginatedResponse<BsdPlayer>;
  try {
    data = (await res.json()) as BsdPaginatedResponse<BsdPlayer>;
  } catch {
    return null; // malformed JSON — non-fatal
  }

  if (!data.results || data.results.length === 0) return null;

  // Collect candidates where ALL significant query words appear as exact whole words.
  // If more than one candidate passes, the result is ambiguous — return null.
  const strongMatches: Array<{ id: number; cn: string; shortNameNorm: string }> = [];
  for (const player of data.results) {
    const cn = normalizeName(player.name);
    if (allQueryWordsMatch(normalized, cn)) {
      strongMatches.push({
        id: player.id,
        cn,
        shortNameNorm: player.short_name ? normalizeName(player.short_name) : "",
      });
    }
  }

  if (strongMatches.length !== 1) {
    if (strongMatches.length > 1) {
      logger.debug({ normalized, count: strongMatches.length }, "BSD Tennis: ambiguous search result, skipping alias");
    }
    return null;
  }

  const { id, cn, shortNameNorm } = strongMatches[0]!;
  // Cache: candidate's own canonical name, any short-name, AND the queried name.
  // All three now hit the fast exact-match path on future calls.
  cache.set(cn, id);
  if (shortNameNorm) cache.set(shortNameNorm, id);
  cache.set(normalized, id);

  logger.debug({ normalized, surname, bsdId: id }, "BSD Tennis: player found via search fallback");
  return id;
}

async function findBsdPlayerIdByName(
  name: string,
): Promise<{ id: number; via: BsdResolvedVia } | null> {
  const cache = await getRankingsCache();
  const normalized = normalizeName(name);

  // 1. Exact normalized match — fast path (covers both primary names and previously cached aliases).
  if (cache.has(normalized)) return { id: cache.get(normalized)!, via: "rankings-cache" };

  // 2. Full-word rankings-cache scan: every significant query word must appear as an exact whole
  //    word in the cache entry. Only safe when EXACTLY ONE entry matches (no shared-surname
  //    aliasing risk). Zero or multiple matches → fall through to the search endpoint.
  const queryWords = normalized.split(" ").filter(w => w.length > 1);
  if (queryWords.length >= 2) {
    const cacheMatches: Array<{ id: number }> = [];
    for (const [cName, id] of cache.entries()) {
      if (allQueryWordsMatch(normalized, cName)) cacheMatches.push({ id });
    }
    if (cacheMatches.length === 1) {
      return { id: cacheMatches[0]!.id, via: "rankings-cache" };
    }
    // 0 → no ranked player matches all words; >1 → ambiguous. Fall through to search.
  }

  // 3. Player not in top-500 rankings cache: try the BSD player-search endpoint.
  //    On success the resolved ID is stored in the cache so repeat lookups are instant.
  const searchId = await searchBsdPlayerByName(normalized, cache);
  return searchId !== null ? { id: searchId, via: "search-fallback" } : null;
}

/** Test-only escape hatch: force the next call to rebuild the rankings cache from scratch. */
export function resetBsdRankingsCacheForTests(): void {
  _rankingsCache = null;
}

// ─── Match history fetch ──────────────────────────────────────────────────────

async function fetchBsdPlayerMatches(
  bsdPlayerId: number,
  playerName: string,
): Promise<MatchRecord[]> {
  const res = await bsdFetch(
    `/tennis/api/v2/matches/?player_id=${bsdPlayerId}&limit=${MAX_MATCHES_PER_FETCH}`,
  );
  if (!res.ok) throw new Error(`BSD matches HTTP ${res.status}`);
  const data = (await res.json()) as BsdPaginatedResponse<BsdMatch>;

  const records: MatchRecord[] = [];
  for (const m of data.results) {
    const rec = mapMatch(m, bsdPlayerId);
    if (rec) records.push(rec);
  }

  logger.debug(
    { bsdPlayerId, playerName, fetched: data.results.length, mapped: records.length },
    "BSD Tennis match history fetched",
  );
  return records;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch completed match history for a player by name from BSD Tennis.
 * Returns empty results (non-throwing) when the key is not configured or the
 * player is not found via rankings cache or the player-search fallback.
 *
 * `resolvedVia` in the return value tells the caller whether the BSD player ID
 * came from the fast rankings cache or the slower player-search endpoint —
 * so composite provider logs can distinguish the two paths.
 */
export async function fetchFromBsdTennis(
  playerName: string,
): Promise<{ records: MatchRecord[]; resolvedVia?: BsdResolvedVia }> {
  if (!getKey()) return { records: [] };

  const resolved = await findBsdPlayerIdByName(playerName);
  if (!resolved) {
    logger.debug({ playerName }, "BSD Tennis: player not found in rankings cache or search");
    return { records: [] };
  }

  const records = await fetchBsdPlayerMatches(resolved.id, playerName);
  return { records, resolvedVia: resolved.via };
}
