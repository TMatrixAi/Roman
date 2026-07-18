import { Router, type IRouter } from "express";
import {
  SearchPlayersQueryParams,
  SearchPlayersResponse,
  GetPlayerParams,
  GetPlayerResponse,
  GetPlayerMatchesParams,
  GetPlayerMatchesResponse,
  GetPlayerStatsParams,
  GetPlayerStatsResponse,
} from "@workspace/api-zod";
import { db, playerStatsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getTennisDataProvider, ProviderUnavailableError } from "../services/tennisData";
import { resolvePlayerProfile, searchKnownPlayers, canonicalizePlayerId, getCachedPlayerIdentityIndex } from "../services/tennisData/playerIdentity";
import { PLAYER_STATS_FRESH_MS } from "../services/playerStats/compute";

const router: IRouter = Router();

router.get("/players/search", async (req, res): Promise<void> => {
  const parsed = SearchPlayersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const players = await searchKnownPlayers(getTennisDataProvider(), parsed.data.query);
    res.json(SearchPlayersResponse.parse(players));
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      res.status(502).json({ error: "Tennis data provider unavailable", detail: err.message });
      return;
    }
    throw err;
  }
});

router.get("/players/:playerId", async (req, res): Promise<void> => {
  const params = GetPlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const player = await resolvePlayerProfile(getTennisDataProvider(), params.data.playerId);
    if (!player) {
      res.status(404).json({ error: "Player not found" });
      return;
    }
    res.json(GetPlayerResponse.parse(player));
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      res.status(502).json({ error: "Tennis data provider unavailable", detail: err.message });
      return;
    }
    throw err;
  }
});

/**
 * GET /players/:playerId/stats
 *
 * Returns the cached aggregate performance stats for a player from the `player_stats` table.
 * HTTP 404 when no stats row exists yet (not yet computed by the backfill pipeline).
 *
 * Callers may check `computedAt` to determine whether the cache is fresh (< 48 h) or stale.
 * Stale data is still returned — it reflects the last full replay; callers decide whether to
 * act on it or treat it as background context.
 */
router.get("/players/:playerId/stats", async (req, res): Promise<void> => {
  const params = GetPlayerStatsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Resolve the raw player ID to its canonical form so we look up the right cache row
  // even when the caller passes an alias ID.
  const index = await getCachedPlayerIdentityIndex();
  const canonicalId = canonicalizePlayerId(index, params.data.playerId);

  const rows = await db
    .select()
    .from(playerStatsTable)
    .where(eq(playerStatsTable.playerId, canonicalId))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "Stats not yet computed for this player — run the backfill pipeline first." });
    return;
  }

  const row = rows[0]!;
  const isStale = Date.now() - row.computedAt.getTime() > PLAYER_STATS_FRESH_MS;
  if (isStale) {
    res.setHeader("X-Stats-Stale", "true");
  }
  res.json(GetPlayerStatsResponse.parse(row));
});

router.get("/players/:playerId/matches", async (req, res): Promise<void> => {
  const params = GetPlayerMatchesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const matches = await getTennisDataProvider().getPlayerMatches(params.data.playerId);
    res.json(GetPlayerMatchesResponse.parse(matches));
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      res.status(502).json({ error: "Tennis data provider unavailable", detail: err.message });
      return;
    }
    throw err;
  }
});

export default router;
