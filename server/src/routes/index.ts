/**
 * Top-level route aggregator mounting all sub-routers.
 */
import { Router } from 'express';
import UsersRoutes from './users';
import ListingsRoutes from './listings';
import FellowshipsRoutes from './fellowships';
import ProgramsRoutes from './programs';
import AnalyticsRoutes from './analytics';
import ResearchAreasRoutes from './researchAreas';
import ConfigRoutes from './config';
import AdminRoutes from './admin';
import ProfileRoutes from './profiles';
import SeedRoutes from './seed';
import ResearchGroupsRoutes from './researchGroups';
import OpportunitiesRoutes from './opportunities';

const router = Router();

router.use('/listings', ListingsRoutes);
router.use('/programs', ProgramsRoutes);
router.use('/fellowships', (req, res, next) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', '</api/programs>; rel="successor-version"');
  next();
}, FellowshipsRoutes);
router.use('/users', UsersRoutes);
router.use('/profiles', ProfileRoutes);
router.use('/research', ResearchGroupsRoutes);
router.use('/opportunities', OpportunitiesRoutes);
router.use('/analytics', AnalyticsRoutes);
router.use('/research-areas', ResearchAreasRoutes);
router.use('/config', ConfigRoutes);
router.use('/admin', AdminRoutes);

if (process.env.NODE_ENV === 'development') {
  router.use('/seed', SeedRoutes);
}

export default router;
