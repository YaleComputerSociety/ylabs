/**
 * Top-level route aggregator mounting all sub-routers.
 */
import { Router } from 'express';
import UsersRoutes from './users';
import FellowshipsRoutes from './fellowships';
import ProgramsRoutes from './programs';
import AnalyticsRoutes from './analytics';
import ConfigRoutes from './config';
import AdminRoutes from './admin';
import ResearchGroupsRoutes from './researchGroups';
import ReadinessRoutes from './ready';
import { redactWithheldNamesInJson } from '../middleware/directoryRemovalFreshness';

const router = Router();

router.use('/programs', redactWithheldNamesInJson, ProgramsRoutes);
router.use(
  '/fellowships',
  redactWithheldNamesInJson,
  (req, res, next) => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', '</api/programs>; rel="successor-version"');
    next();
  },
  FellowshipsRoutes,
);
router.use(['/users/savedResearchEntities', '/users/watchedPrograms'], redactWithheldNamesInJson);
router.use('/users', UsersRoutes);
router.use('/research', redactWithheldNamesInJson, ResearchGroupsRoutes);
router.use('/analytics', AnalyticsRoutes);
router.use('/config', ConfigRoutes);
router.use('/admin', AdminRoutes);
router.use('/ready', ReadinessRoutes);

export default router;
