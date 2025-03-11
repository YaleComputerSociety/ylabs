import { Router } from "express";
import ListingsRoutes from "./listings";
import UsersRoutes from "./users";
import UserBackupsRoutes from "./userBackups";
import { isAuthenticated } from "../middlewares/auth";

const router = Router();

router.use("/listings", isAuthenticated, ListingsRoutes);
router.use("/users", isAuthenticated, UsersRoutes);
router.use("/userBackups", isAuthenticated, UserBackupsRoutes);

export default router;