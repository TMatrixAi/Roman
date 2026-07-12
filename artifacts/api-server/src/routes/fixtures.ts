import { Router, type IRouter } from "express";
import { GetUpcomingFixturesQueryParams, GetUpcomingFixturesResponse } from "@workspace/api-zod";
import { getTennisDataProvider, ProviderUnavailableError } from "../services/tennisData";

const router: IRouter = Router();

router.get("/fixtures/upcoming", async (req, res): Promise<void> => {
  const parsed = GetUpcomingFixturesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);

  try {
    const fixtures = await getTennisDataProvider().getUpcomingFixtures(date);
    // Today's Fixtures is always shown in real chronological order (earliest start time first) --
    // sorted here so every consumer of this endpoint gets the same order without re-implementing it.
    const sorted = [...fixtures].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    res.json(GetUpcomingFixturesResponse.parse(sorted));
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      res.status(502).json({ error: "Tennis data provider unavailable", detail: err.message });
      return;
    }
    throw err;
  }
});

export default router;
