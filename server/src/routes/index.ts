import { Router } from "express";
import UsersRoutes from "./users";
import ListingsRoutes from "./listings";

const router = Router();

router.use("/listings", ListingsRoutes);
router.use("/users", UsersRoutes);

export default router;