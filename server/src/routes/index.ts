import { Router } from "express";
import UsersRoutes from "./users";
import ListingsRoutes from "./listings";
import FellowshipsRoutes from "./fellowships";
import AnalyticsRoutes from "./analytics";
import ResearchAreasRoutes from "./researchAreas";
import ConfigRoutes from "./config";
import AdminRoutes from "./admin";
import SeedRoutes from "./seed";

const router = Router();

router.use("/listings", ListingsRoutes);
router.use("/fellowships", FellowshipsRoutes);
router.use("/users", UsersRoutes);
router.use("/analytics", AnalyticsRoutes);
router.use("/research-areas", ResearchAreasRoutes);
router.use("/config", ConfigRoutes);
router.use("/admin", AdminRoutes);

// Dev-only seed routes for the faculty scraper (no auth required)
if (process.env.NODE_ENV === 'development') {
  router.use("/seed", SeedRoutes);
}

export default router;