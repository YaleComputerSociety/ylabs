import { Router } from "express";
import UsersRoutes from "./users";
import ListingsRoutes from "./listings";
import AnalyticsRoutes from "./analytics";
import EmailRoutes from "./email";

const router = Router();

router.use("/listings", ListingsRoutes);
router.use("/users", UsersRoutes);
router.use("/analytics", AnalyticsRoutes);
router.use("/email", EmailRoutes);

export default router;