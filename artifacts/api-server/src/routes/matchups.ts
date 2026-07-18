import { Router, type IRouter } from "express";
import { RecognizeMatchupScreenshotBody, RecognizeMatchupScreenshotResponse } from "@workspace/api-zod";
import { getTennisDataProvider, ProviderUnavailableError } from "../services/tennisData";
import { recognizeMatchupScreenshot, ScreenshotRecognitionUnavailableError, type RawScreenshotRecognition } from "../services/tennisData/screenshotRecognition";
import { resolveScreenshotMatchup } from "../services/tennisData/screenshotMatchupResolver";
import { inferSurfaceAndLevel } from "../services/tennisData/surfaceMap";
const router: IRouter = Router();

/**
 * POST /api/matchups/from-screenshot
 * Accepts a base64 image, runs vision AI to extract matchups, resolves players and event.
 * Returns the result including `debugLog` (stage-by-stage pipeline trace) and `rawText`
 * (the raw vision model output before parsing) so the frontend can show real failure reasons.
 */
router.post("/matchups/from-screenshot", async (req, res): Promise<void> => {
  const parsed = RecognizeMatchupScreenshotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const raw = await recognizeMatchupScreenshot(parsed.data.imageBase64);
    const { debugLog, rawText, ...rawForResolver } = raw;
    const result = await resolveScreenshotMatchup(getTennisDataProvider(), rawForResolver);
    // Use passthrough() so debugLog/rawText are preserved alongside the validated fields.
    res.json(RecognizeMatchupScreenshotResponse.passthrough().parse({ ...result, debugLog, rawText }));
  } catch (err) {
    if (err instanceof ScreenshotRecognitionUnavailableError) {
      res.status(502).json({
        error: "Vision AI provider unavailable",
        detail: err.message,
        debugLog: err.debugLog ?? [],
      });
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
 * POST /api/matchups/from-text-names
 * Accepts pre-parsed player name pairs (e.g. from a user editing the raw OCR text) and resolves
 * them to real players + event info using the same resolver as the screenshot endpoint.
 * This is the backend for the "raw text fallback" UI when OCR succeeds but JSON parsing fails or
 * returns 0 matches.
 */
router.post("/matchups/from-text-names", async (req, res): Promise<void> => {
  const body = req.body as { matchups?: unknown };
  if (!body || !Array.isArray(body.matchups) || body.matchups.length === 0) {
    res.status(400).json({ error: "matchups must be a non-empty array" });
    return;
  }
  if (body.matchups.length > 20) {
    res.status(400).json({ error: "maximum 20 matchups per request" });
    return;
  }

  const raw: RawScreenshotRecognition = {
    matchups: (body.matchups as Record<string, unknown>[]).map((m) => ({
      player1Name: typeof m.player1Name === "string" ? m.player1Name : null,
      player2Name: typeof m.player2Name === "string" ? m.player2Name : null,
      eventName: typeof m.eventName === "string" ? m.eventName : null,
    })),
  };

  try {
    const result = await resolveScreenshotMatchup(getTennisDataProvider(), raw);
    res.json(RecognizeMatchupScreenshotResponse.passthrough().parse(result));
  } catch (err) {
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
 */
router.get("/tournament/surface", async (req, res): Promise<void> => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name query param required" });
    return;
  }

  let { surface, level } = inferSurfaceAndLevel(name);

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
