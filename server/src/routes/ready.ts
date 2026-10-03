import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { checkReadiness, defaultReadinessProbes, isReady } from '../services/readinessService';

export const createReadinessRouter = (probes = defaultReadinessProbes) => {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async function readiness(_req: Request, res: Response) {
      const { mongo, search } = await checkReadiness(probes);
      res.set('Cache-Control', 'no-store, private, max-age=0');
      res.status(isReady({ mongo, search }) ? 200 : 503).json({ mongo, search });
    }),
  );

  return router;
};

export default createReadinessRouter();
