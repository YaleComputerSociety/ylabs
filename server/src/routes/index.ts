/**
 * Top-level route aggregator mounting all sub-routers.
 */
import { Router } from 'express';
import UsersRoutes from './users';
import ListingsRoutes from './listings';
import FellowshipsRoutes from './fellowships';
import AnalyticsRoutes from './analytics';
import ResearchAreasRoutes from './researchAreas';
import ConfigRoutes from './config';
import AdminRoutes from './admin';
import ProfileRoutes from './profiles';
import SeedRoutes from './seed';
import ResearchGroupsRoutes from './researchGroups';
import PathwaysRoutes from './pathways';
import OpportunitiesRoutes from './opportunities';

const router = Router();

router.use('/listings', ListingsRoutes);
router.use('/fellowships', FellowshipsRoutes);
router.use('/users', UsersRoutes);
router.use('/profiles', ProfileRoutes);
router.use('/research', ResearchGroupsRoutes);
router.use('/pathways', PathwaysRoutes);
router.use('/opportunities', OpportunitiesRoutes);
router.use('/analytics', AnalyticsRoutes);
router.use('/research-areas', ResearchAreasRoutes);
router.use('/config', ConfigRoutes);
router.use('/admin', AdminRoutes);

if (process.env.NODE_ENV === 'development') {
  router.use('/seed', SeedRoutes);
}

export default router;
