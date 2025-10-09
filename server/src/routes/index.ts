import { Router } from "express";
import ListingsRoutes from "./listings";
import UsersRoutes from "./users";
import UserBackupsRoutes from "./userBackups";
import NewListingsRoutes from "./newListings";
import ApplicationsRoutes from "./applications";

const router = Router();

router.use("/newListings", NewListingsRoutes);
router.use("/listings", ListingsRoutes);
router.use("/users", UsersRoutes);
router.use("/userBackups", UserBackupsRoutes);
router.use("/applications", ApplicationsRoutes);

export default router;