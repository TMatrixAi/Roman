import { Router, type IRouter } from "express";
import { RecognizeMatchupScreenshotBody, RecognizeMatchupScreenshotResponse } from "@workspace/api-zod";
import { getTennisDataProvider, ProviderUnavailableError } from "../services/tennisData";
import { recognizeMatchupScreenshot, ScreenshotRecognitionUnavailableError } from "../services/tennisData/screenshotRecognition";
import { resolveScreenshotMatchup } from "../services/tennisData/screenshotMatchupResolver";

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

export default router;
