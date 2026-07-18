/**
 * Player performance cache computation — derives aggregate stats from `historical_matches`
 * and `match_feature_snapshots`, then upserts them into `player_stats`.
 *
 * Used by two call sites:
 *   1. The backfill pipeline — after each incremental run, refresh stats for every player
 *      whose matches changed.
 *   2. The ledger grading cycle — after a prediction is settled, refresh stats for the two
 *      players involved so the UI profile cards reflect the newly-graded result.
 *
 * Never reads from the external tennis data provider — this is a pure aggregation over
 * already-imported, immutable historical match rows. Caller-supplied `allPlayerIds` must
 * include every alias ID under which this canonical player has appeared in `historical_matches`
 * (from `getAliasIds(index, canonicalId)`) or the replay will silently miss their alias history.
 */
import { db, historicalMatchesTable, matchFeatureSnapshotsTable, playerStatsTable } from "@workspace/db";
import type { PlayerSurfaceStatsJson } from "@workspace/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { canonicalizePlayerId, getAliasIds, getCachedPlayerIdentityIndex } from "../tennisData/playerIdentity";

// ─── Constants ───────────────────────────────────────────────────────────────

const STARTING_ELO = 1500;
const ELO_K = 32;
/** Minimum set count with real score data for the serve/return proxy to be meaningful. */
const MIN_MARGIN_SAMPLE = 5;
/** Most-recent N matches for win-rate / game-share summary (oldest-first replay order). */
const RECENT_WINDOW = 100;
/** Most-recent N matches for opponent strength average. */
const OPPONENT_WINDOW = 50;
/** Cache age threshold (ms) — a row younger than this is considered fresh. */
export const PLAYER_STATS_FRESH_MS = 48 * 60 * 60 * 1000; // 48 hours

// ─── Internal types ──────────────────────────────────────────────────────────

type GameMargins = Array<{ player1Games: number; player2Games: number }>;

interface ReplayMatch {
  id: number;
  isPlayer1: boolean;
  won: boolean;
  surface: string | null;
  /** 0-1, from player's perspective. Null when no margin data in the row. */
  gameShare: number | null;
  opponentId: string;
}

interface StatsFields {
  matchesPlayed: number;
  overallElo: number | null;
  eloHard: number | null;
  eloClay: number | null;
  eloGrass: number | null;
  eloIndoorHard: number | null;
  winRateLast100: number | null;
  gameShareLast100: number | null;
  serveRatingProxy: number | null;
  returnRatingProxy: number | null;
  surfaceStats: PlayerSurfaceStatsJson | null;
  opponentStrengthAvg: number | null;
}

// ─── Core computation ────────────────────────────────────────────────────────

async function computeAndUpsertOnePlayer(canonicalId: string, allIds: string[]): Promise<void> {
  if (allIds.length === 0) return;

  const allIdsSet = new Set(allIds);

  // Fetch every historical match for this player (all alias IDs), chronologically.
  const rows = await db
    .select({
      id: historicalMatchesTable.id,
      player1Id: historicalMatchesTable.player1Id,
      player2Id: historicalMatchesTable.player2Id,
      winnerId: historicalMatchesTable.winnerId,
      cancelled: historicalMatchesTable.cancelled,
      surface: historicalMatchesTable.surface,
      gameMarginsPlayer1: historicalMatchesTable.gameMarginsPlayer1,
    })
    .from(historicalMatchesTable)
    .where(
      or(
        inArray(historicalMatchesTable.player1Id, allIds),
        inArray(historicalMatchesTable.player2Id, allIds),
      ),
    )
    .orderBy(asc(historicalMatchesTable.scheduledStartAt), asc(historicalMatchesTable.id));

  // Only matches with a terminal result contribute to stats.
  const played = rows.filter((r) => !r.cancelled && r.winnerId !== null);

  if (played.length === 0) {
    await upsertStats(canonicalId, {
      matchesPlayed: 0, overallElo: null, eloHard: null, eloClay: null, eloGrass: null,
      eloIndoorHard: null, winRateLast100: null, gameShareLast100: null,
      serveRatingProxy: null, returnRatingProxy: null, surfaceStats: null, opponentStrengthAvg: null,
    });
    return;
  }

  // Pre-load opponent Elo at match time from match_feature_snapshots (eloOverall feature,
  // written at import time by the backfill pipeline, strictly before each match's cutoff).
  const matchIds = played.map((r) => r.id);
  const opponentEloRows = await db
    .select({
      matchId: matchFeatureSnapshotsTable.matchId,
      playerId: matchFeatureSnapshotsTable.playerId,
      featureValue: matchFeatureSnapshotsTable.featureValue,
    })
    .from(matchFeatureSnapshotsTable)
    .where(
      and(
        inArray(matchFeatureSnapshotsTable.matchId, matchIds),
        eq(matchFeatureSnapshotsTable.featureName, "eloOverall"),
      ),
    );

  // Build matchId → opponent's pre-match eloOverall.
  const matchOpponentId = new Map<number, string>();
  for (const r of played) {
    matchOpponentId.set(r.id, allIdsSet.has(r.player1Id) ? r.player2Id : r.player1Id);
  }
  const opponentEloAtMatch = new Map<number, number>();
  for (const row of opponentEloRows) {
    const expected = matchOpponentId.get(row.matchId);
    if (expected && row.playerId === expected) {
      opponentEloAtMatch.set(row.matchId, row.featureValue);
    }
  }

  // ── Chronological Elo replay ────────────────────────────────────────────────
  // Same formula as features.ts / backfill.ts (K=32, starting at 1500).
  let overallElo = STARTING_ELO;
  const eloBySurface: Partial<Record<string, number>> = {};
  const surfaceStats: Record<string, { wins: number; losses: number }> = {};
  const replay: ReplayMatch[] = [];
  let marginWeightedSum = 0;
  let marginSetCount = 0;

  for (const row of played) {
    const isPlayer1 = allIdsSet.has(row.player1Id);
    const opponentId = isPlayer1 ? row.player2Id : row.player1Id;
    const won = allIdsSet.has(row.winnerId!);
    const opponentElo = opponentEloAtMatch.get(row.id) ?? STARTING_ELO;

    // Game share + margin proxy from gameMarginsPlayer1 (player1-perspective storage).
    const margins = (row.gameMarginsPlayer1 as GameMargins) ?? [];
    let myGames = 0;
    let totalGames = 0;
    for (const m of margins) {
      if (m.player1Games + m.player2Games === 0) continue; // skip padding zeros
      const pg = isPlayer1 ? m.player1Games : m.player2Games;
      const og = isPlayer1 ? m.player2Games : m.player1Games;
      myGames += pg;
      totalGames += pg + og;
      marginWeightedSum += pg - og;
      marginSetCount++;
    }
    const gameShare = totalGames > 0 ? myGames / totalGames : null;

    // Elo update.
    const expOverall = 1 / (1 + 10 ** ((opponentElo - overallElo) / 400));
    overallElo = overallElo + ELO_K * ((won ? 1 : 0) - expOverall);

    if (row.surface) {
      const currentSurface = eloBySurface[row.surface] ?? STARTING_ELO;
      const expSurface = 1 / (1 + 10 ** ((opponentElo - currentSurface) / 400));
      eloBySurface[row.surface] = currentSurface + ELO_K * ((won ? 1 : 0) - expSurface);

      const s = surfaceStats[row.surface] ?? { wins: 0, losses: 0 };
      if (won) s.wins++;
      else s.losses++;
      surfaceStats[row.surface] = s;
    }

    replay.push({ id: row.id, isPlayer1, won, surface: row.surface, gameShare, opponentId });
  }

  // ── Summary stats (most-recent N, oldest-first replay) ─────────────────────
  const last100 = replay.slice(-RECENT_WINDOW);
  const winRateLast100 = last100.length > 0 ? round3(last100.filter((m) => m.won).length / last100.length) : null;

  const withGs = last100.filter((m) => m.gameShare !== null);
  const gameShareLast100 = withGs.length > 0 ? round3(withGs.reduce((s, m) => s + m.gameShare!, 0) / withGs.length) : null;

  // Opponent strength: average opponent Elo for the most-recent OPPONENT_WINDOW matches.
  const last50 = replay.slice(-OPPONENT_WINDOW);
  const knownOpponentElos = last50.map((m) => opponentEloAtMatch.get(m.id)).filter((v): v is number => v !== undefined);
  const opponentStrengthAvg = knownOpponentElos.length > 0
    ? Math.round(knownOpponentElos.reduce((a, b) => a + b, 0) / knownOpponentElos.length)
    : null;

  // Serve/return dominance proxy from game margins (formula: 50 + avgMarginPerSet * 6, [5,95]).
  let serveRatingProxy: number | null = null;
  let returnRatingProxy: number | null = null;
  if (marginSetCount >= MIN_MARGIN_SAMPLE) {
    const rating = Math.max(5, Math.min(95, 50 + (marginWeightedSum / marginSetCount) * 6));
    serveRatingProxy = Math.round(rating);
    returnRatingProxy = Math.round(rating); // no point-level split without raw stats
  }

  await upsertStats(canonicalId, {
    matchesPlayed: replay.length,
    overallElo: Math.round(overallElo),
    eloHard: eloBySurface["Hard"] !== undefined ? Math.round(eloBySurface["Hard"]!) : null,
    eloClay: eloBySurface["Clay"] !== undefined ? Math.round(eloBySurface["Clay"]!) : null,
    eloGrass: eloBySurface["Grass"] !== undefined ? Math.round(eloBySurface["Grass"]!) : null,
    eloIndoorHard: eloBySurface["IndoorHard"] !== undefined ? Math.round(eloBySurface["IndoorHard"]!) : null,
    winRateLast100,
    gameShareLast100,
    serveRatingProxy,
    returnRatingProxy,
    surfaceStats: Object.keys(surfaceStats).length > 0 ? (surfaceStats as PlayerSurfaceStatsJson) : null,
    opponentStrengthAvg,
  });
}

// ─── Upsert helper ───────────────────────────────────────────────────────────

async function upsertStats(playerId: string, fields: StatsFields): Promise<void> {
  const computedAt = new Date();
  await db
    .insert(playerStatsTable)
    .values({ playerId, computedAt, ...fields })
    .onConflictDoUpdate({
      target: playerStatsTable.playerId,
      set: { computedAt, ...fields },
    });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Refreshes the `player_stats` cache for a set of raw player IDs. Automatically resolves each
 * raw ID to its canonical ID (merging aliases) so a single row is written per real player.
 *
 * Safe to call with duplicate IDs — each canonical player is processed exactly once per call.
 * Never throws; per-player failures are logged as warnings and do not abort the rest of the batch.
 *
 * @param playerIds Raw player IDs as reported by the provider / stored in `historical_matches`.
 *   May include alias IDs — these are resolved and deduplicated before processing.
 */
export async function refreshPlayerStats(playerIds: string[]): Promise<void> {
  if (playerIds.length === 0) return;

  const index = await getCachedPlayerIdentityIndex();

  const seen = new Set<string>();
  const groups: Array<{ canonicalId: string; allIds: string[] }> = [];
  for (const rawId of playerIds) {
    const canonicalId = canonicalizePlayerId(index, rawId);
    if (seen.has(canonicalId)) continue;
    seen.add(canonicalId);
    groups.push({ canonicalId, allIds: getAliasIds(index, canonicalId) });
  }

  let succeeded = 0;
  let failed = 0;
  for (const { canonicalId, allIds } of groups) {
    try {
      await computeAndUpsertOnePlayer(canonicalId, allIds);
      succeeded++;
    } catch (err) {
      failed++;
      logger.warn({ canonicalId, err }, "refreshPlayerStats: failed to compute stats for player — skipping");
    }
  }

  logger.info(
    { requested: playerIds.length, uniquePlayers: groups.length, succeeded, failed },
    "Player stats refresh complete",
  );
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
