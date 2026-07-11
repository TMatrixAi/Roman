import { Router, type IRouter } from "express";
import {
  SearchPlayersQueryParams,
  SearchPlayersResponse,
  GetPlayerParams,
  GetPlayerResponse,
  GetPlayerMatchesParams,
  GetPlayerMatchesResponse,
} from "@workspace/api-zod";
import { getTennisDataProvider, ProviderUnavailableError } from "../services/tennisData";
import { resolvePlayerProfile, searchKnownPlayers } from "../services/tennisData/playerIdentity";

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
