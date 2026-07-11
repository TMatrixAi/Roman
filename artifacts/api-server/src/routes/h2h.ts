import { Router, type IRouter } from "express";
import { GetHeadToHeadQueryParams, GetHeadToHeadResponse } from "@workspace/api-zod";
import { getTennisDataProvider, ProviderUnavailableError } from "../services/tennisData";

const router: IRouter = Router();

router.get("/h2h", async (req, res): Promise<void> => {
  const parsed = GetHeadToHeadQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const record = await getTennisDataProvider().getHeadToHead(parsed.data.player1Id, parsed.data.player2Id);
    res.json(GetHeadToHeadResponse.parse(record));
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      res.status(502).json({ error: "Tennis data provider unavailable", detail: err.message });
      return;
    }
    throw err;
  }
});

export default router;
