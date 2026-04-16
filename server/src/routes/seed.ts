/**
 * Development-only seed routes for the faculty scraper.
 * These routes have NO auth — only mounted when NODE_ENV=development.
 */
import { Router, Request, Response } from "express";
import { createUser, validateUser, updateUser } from "../services/userService";
import { updateListing, readAllListings } from "../services/listingService";

const router = Router();

router.post("/users", async (req: Request, res: Response) => {
  try {
    const { netid } = req.body;
    if (!netid) {
      return res.status(400).json({ error: "netid is required" });
    }

    const existing = await validateUser(netid);
    if (existing) {
      const { favListings, favFellowships, ownListings, ...safeData } = req.body;
      const updated = await updateUser(netid, safeData);
      return res.json({ action: "updated", user: updated });
    }

    const user = await createUser(req.body);
    res.status(201).json({ action: "created", user });
  } catch (error: any) {
    console.error("Seed: Error creating/updating user:", error);
    res.status(400).json({ error: error.message });
  }
});

router.put("/users/:netid", async (req: Request, res: Response) => {
  try {
    const existing = await validateUser(req.params.netid);
    if (!existing) {
      return res.status(404).json({ error: "User not found" });
    }

    const { favListings, favFellowships, ownListings, ...safeData } = req.body;
    const updated = await updateUser(req.params.netid, safeData);
    res.json({ action: "updated", user: updated });
  } catch (error: any) {
    console.error("Seed: Error updating user:", error);
    res.status(400).json({ error: error.message });
  }
});

router.get("/listings", async (req: Request, res: Response) => {
  try {
    const listings = await readAllListings();
    res.json({ results: listings });
  } catch (error: any) {
    console.error("Seed: Error fetching listings:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put("/listings/:id", async (req: Request, res: Response) => {
  try {
    const { departments } = req.body;
    const listing = await updateListing(req.params.id, '' as string, { departments }, true);
    res.json({ listing });
  } catch (error: any) {
    console.error("Seed: Error updating listing:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
