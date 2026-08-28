/**
 * Express routes for client configuration (departments, research areas).
 */
import { Router, Request, Response } from 'express';
import { getConfig } from '../services/configService';
import { sanitizeLogValue } from '../utils/logSanitizer';

const router = Router();

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

export default router;
