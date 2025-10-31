import { Router } from "express";
import UsersRoutes from "./users";
import ListingsRoutes from "./listings";
import ApplicationsRoutes from "./applications";

const router = Router();

router.use("/listings", ListingsRoutes);
router.use("/users", UsersRoutes);
router.use("/applications", ApplicationsRoutes);

export default router;