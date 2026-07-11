import { Router, type IRouter } from "express";
import { GetProviderStatusResponse } from "@workspace/api-zod";
import { getTennisDataProvider } from "../services/tennisData";

const router: IRouter = Router();

router.get("/provider/status", (_req, res): void => {
  const provider = getTennisDataProvider();
  const status = provider.getStatus();
  res.json(GetProviderStatusResponse.parse(status));
});

export default router;
