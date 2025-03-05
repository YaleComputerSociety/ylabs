import { Router } from "express";
import ListingsRoutes from "./listings";
import UsersRoutes from "./users";
import UserBackupsRoutes from "./userBackups";

const router = Router();

router.use("/listings", ListingsRoutes);

//User routes hidden for security reasons

/*
router.use("/users", UsersRoutes);
router.use("/userBackups", UserBackupsRoutes);*/

export default router;