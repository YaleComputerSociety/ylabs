/**
 * Express routes for client configuration (departments, research areas).
 */
import { Router, Request, Response } from 'express';
import { getConfig, invalidateConfigCache } from '../services/configService';
import { isAuthenticated, isAdmin } from '../middleware/index';
import { sanitizeLogValue } from '../utils/logSanitizer';

const router = Router();

function setPrivateConfigRefreshCacheHeaders(_req: Request, res: Response, next: () => void) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const config = await getConfig();

    res.set('Cache-Control', 'public, max-age=300');
    res.removeHeader('Pragma');
    res.removeHeader('Surrogate-Control');
    res.vary('Origin');
    res.status(200).json(config);
  } catch (error) {
    console.error('Error fetching config:', sanitizeLogValue(error));
    res.status(500).json({ message: 'Error fetching configuration data' });
  }
});

router.post(
  '/refresh',
  setPrivateConfigRefreshCacheHeaders,
  isAuthenticated,
  isAdmin,
  async (req: Request, res: Response) => {
    try {
      invalidateConfigCache();
      const config = await getConfig(true);
      res.status(200).json({ message: 'Config cache refreshed', config });
    } catch (error) {
      console.error('Error refreshing config:', sanitizeLogValue(error));
      res.status(500).json({ message: 'Error refreshing configuration data' });
    }
  },
);

export default router;
