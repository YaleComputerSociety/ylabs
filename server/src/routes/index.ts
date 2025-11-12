import { Router } from "express";
import UsersRoutes from "./users";
import ListingsRoutes from "./listings";
import AnalyticsRoutes from "./analytics";

const router = Router();

router.use("/listings", ListingsRoutes);
router.use("/users", UsersRoutes);
router.use("/analytics", AnalyticsRoutes);

export default router;