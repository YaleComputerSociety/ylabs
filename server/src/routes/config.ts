import { Router, Request, Response } from "express";
import { getConfig, invalidateConfigCache } from '../services/configService';
import { isAuthenticated } from '../middleware';

const router = Router();

// GET /api/config - Get all config data (departments + research areas)
// This is a public endpoint to allow frontend to load without auth
router.get('/', async (req: Request, res: Response) => {
  try {
    const config = await getConfig();

    // Set cache headers for client-side caching
    res.set('Cache-Control', 'public, max-age=300'); // 5 minutes
    res.status(200).json(config);
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ message: 'Error fetching configuration data' });
  }
});

// GET /api/config/refresh - Force refresh config cache (authenticated)
router.get('/refresh', isAuthenticated, async (req: Request, res: Response) => {
  try {
    invalidateConfigCache();
    const config = await getConfig(true); // Force refresh
    res.status(200).json({ message: 'Config cache refreshed', config });
  } catch (error) {
    console.error('Error refreshing config:', error);
    res.status(500).json({ message: 'Error refreshing configuration data' });
  }
});

export default router;
