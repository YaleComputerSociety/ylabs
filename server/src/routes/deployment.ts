/**
 * Operator-only deployment fingerprint route used by post-promotion verification.
 */
import { Router, Request, Response } from 'express';
import { authLimiter } from '../middleware/rateLimiters';
import {
  buildOperatorDeploymentFingerprint,
  isAuthorizedFingerprintToken,
} from '../services/deploymentFingerprintService';

const router = Router();

const DEPLOYMENT_FINGERPRINT_HEADER = 'x-deployment-token';

router.get('/', authLimiter, (req: Request, res: Response) => {
  if (!isAuthorizedFingerprintToken(req.get(DEPLOYMENT_FINGERPRINT_HEADER))) {
    res.status(404).json({ message: 'Not found' });
    return;
  }

  res.set('Cache-Control', 'no-store');
  res.status(200).json(buildOperatorDeploymentFingerprint());
});

export default router;
