import { Router } from "express";
import ListingsRoutes from "./listings";

const router = Router();

router.use("/listings", ListingsRoutes);

export default router;