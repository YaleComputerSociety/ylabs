import { Router } from "express";
import ListingsRoutes from "./listings";
import UsersRoutes from "./users";
import UserBackupsRoutes from "./userBackups";
import NewListingsRoutes from "./newListings";

const router = Router();

router.use("/newListings", NewListingsRoutes);
router.use("/listings", ListingsRoutes);

//User routes hidden for security reasons

/*
router.use("/users", UsersRoutes);
router.use("/userBackups", UserBackupsRoutes);*/

export default router;