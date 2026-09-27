/**
 * Express routes for client configuration (departments, research areas).
 */
import { Router, Request, Response } from 'express';
import { getConfig } from '../services/configService';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const config = await getConfig();

    res.set('Cache-Control', 'public, max-age=300');
    res.removeHeader('Pragma');
    res.removeHeader('Surrogate-Control');
    res.vary('Origin');
    res.status(200).json(config);
  }),
);

export default router;
