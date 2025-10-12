import { Router } from "express";
import UsersRoutes from "./users";
import UserBackupsRoutes from "./userBackups";
import NewListingsRoutes from "./newListings";

const router = Router();

router.use("/newListings", NewListingsRoutes);
router.use("/users", UsersRoutes);
router.use("/userBackups", UserBackupsRoutes);

export default router;