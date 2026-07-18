import { Router, type IRouter } from "express";
import { RecognizeMatchupScreenshotBody, RecognizeMatchupScreenshotResponse } from "@workspace/api-zod";
import { getTennisDataProvider, ProviderUnavailableError } from "../services/tennisData";
import { recognizeMatchupScreenshot, ScreenshotRecognitionUnavailableError } from "../services/tennisData/screenshotRecognition";
import { resolveScreenshotMatchup } from "../services/tennisData/screenshotMatchupResolver";
import { inferSurfaceAndLevel } from "../services/tennisData/surfaceMap";

const router: IRouter = Router();

router.post("/matchups/from-screenshot", async (req, res): Promise<void> => {
  const parsed = RecognizeMatchupScreenshotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const raw = await recognizeMatchupScreenshot(parsed.data.imageBase64);
    const result = await resolveScreenshotMatchup(getTennisDataProvider(), raw);
    res.json(RecognizeMatchupScreenshotResponse.parse(result));
  } catch (err) {
    if (err instanceof ScreenshotRecognitionUnavailableError) {
      res.status(502).json({ error: "Vision AI provider unavailable", detail: err.message });
      return;
    }
    if (err instanceof ProviderUnavailableError) {
      res.status(502).json({ error: "Tennis data provider unavailable", detail: err.message });
      return;
    }
    throw err;
  }
});

/**
 * GET /api/tournament/surface?name=<tournament name>
 * Returns the surface and level for a named tournament.
 * Tries the static name table first (fast, covers majors/Masters/500s/named WTA/ATP events),
 * then falls back to the provider's live tournament search for Challenger/ITF events.
 * Returns { surface: null, level: null } when genuinely unknown — never guesses.
 */
router.get("/tournament/surface", async (req, res): Promise<void> => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name query param required" });
    return;
  }

  let { surface, level } = inferSurfaceAndLevel(name);

  // Static table covers majors/Masters/named events. For anything else,
  // try the provider's live tournament search (covers Challenger/ITF).
  if (surface === null) {
    try {
      const provider = getTennisDataProvider();
      if (provider.findTournamentSurfaceByName) {
        const found = await provider.findTournamentSurfaceByName(name);
        if (found) {
          surface = found.surface;
          level = found.level ?? level;
        }
      }
    } catch {
      // Best-effort: if the provider is unavailable, return whatever the static table gave us.
    }
  }

  res.json({ surface, level });
});

export default router;
