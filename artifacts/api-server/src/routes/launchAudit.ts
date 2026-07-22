import { Router, type IRouter } from 'express';
import { requireAdmin } from '../lib/adminAuth';
import { getLaunchAuditSummary, runLaunchAudit } from '../services/launchAudit';

const router: IRouter = Router();

router.get('/launch-audit/summary', requireAdmin, async (_req, res): Promise<void> => {
  try {
    const summary = await getLaunchAuditSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Launch audit failed' });
  }
});

router.post('/launch-audit/run', requireAdmin, async (_req, res): Promise<void> => {
  try {
    const summary = await runLaunchAudit();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Launch audit failed' });
  }
});

export default router;
