/**
 * Express routes for client configuration (departments, research areas).
 */
import { Router, Request, Response } from 'express';
import { getConfig, invalidateConfigCache } from '../services/configService';
import { isAuthenticated } from '../middleware/index';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const config = await getConfig();

    res.set('Cache-Control', 'public, max-age=300');
    res.status(200).json(config);
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ message: 'Error fetching configuration data' });
  }
});

router.get('/refresh', isAuthenticated, async (req: Request, res: Response) => {
  try {
    invalidateConfigCache();
    const config = await getConfig(true);
    res.status(200).json({ message: 'Config cache refreshed', config });
  } catch (error) {
    console.error('Error refreshing config:', error);
    res.status(500).json({ message: 'Error refreshing configuration data' });
  }
});

export default router;
