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

async function findBsdPlayerIdByName(name: string): Promise<number | null> {
  const cache = await getRankingsCache();
  const normalized = normalizeName(name);

  // Exact normalized match
  if (cache.has(normalized)) return cache.get(normalized)!;

  // Surname-only fallback (last word)
  const surname = normalized.split(" ").pop() ?? "";
  if (surname.length >= 3) {
    for (const [cName, id] of cache.entries()) {
      if (cName.includes(surname)) return id;
    }
  }

  return null;
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
 * player is not found in the top ATP/WTA rankings.
 */
export async function fetchFromBsdTennis(
  playerName: string,
): Promise<{ records: MatchRecord[] }> {
  if (!getKey()) return { records: [] };

  const bsdId = await findBsdPlayerIdByName(playerName);
  if (!bsdId) {
    logger.debug({ playerName }, "BSD Tennis: player not found in rankings cache");
    return { records: [] };
  }

  const records = await fetchBsdPlayerMatches(bsdId, playerName);
  return { records };
}
