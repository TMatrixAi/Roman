import { Router, type IRouter } from "express";
import healthRouter from "./health";
import providerRouter from "./provider";
import playersRouter from "./players";
import fixturesRouter from "./fixtures";
import h2hRouter from "./h2h";
import predictionsRouter from "./predictions";
import evaluationRouter from "./evaluation";

const router: IRouter = Router();

router.use(healthRouter);
router.use(providerRouter);
router.use(playersRouter);
router.use(fixturesRouter);
router.use(h2hRouter);
router.use(predictionsRouter);
router.use(evaluationRouter);

export default router;
