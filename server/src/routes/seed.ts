/**
 * Development-only seed routes for the faculty scraper.
 * These routes have NO auth — only mounted when NODE_ENV=development.
 */
import { Router, Request, Response } from "express";
import { createUser, validateUser, updateUser } from "../services/userService";
import { updateListing, readAllListings } from "../services/listingService";

const router = Router();

// POST /seed/users — create or update a user by netid
router.post("/users", async (req: Request, res: Response) => {
  try {
    const { netid } = req.body;
    if (!netid) {
      return res.status(400).json({ error: "netid is required" });
    }

    // Check if user exists
    const existing = await validateUser(netid);
    if (existing) {
      // Update existing user with new data (don't overwrite favorites, ownListings, etc.)
      const { favListings, favFellowships, ownListings, ...safeData } = req.body;
      const updated = await updateUser(netid, safeData);
      return res.json({ action: "updated", user: updated });
    }

    // Create new user
    const user = await createUser(req.body);
    res.status(201).json({ action: "created", user });
  } catch (error: any) {
    console.error("Seed: Error creating/updating user:", error);
    res.status(400).json({ error: error.message });
  }
});

// PUT /seed/users/:netid — update a user by netid
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

// GET /seed/listings — get all listings (for department matching)
router.get("/listings", async (req: Request, res: Response) => {
  try {
    const listings = await readAllListings();
    res.json({ results: listings });
  } catch (error: any) {
    console.error("Seed: Error fetching listings:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /seed/listings/:id — update a listing's departments
router.put("/listings/:id", async (req: Request, res: Response) => {
  try {
    const { departments } = req.body;
    const listing = await updateListing(req.params.id, undefined, { departments }, true);
    res.json({ listing });
  } catch (error: any) {
    console.error("Seed: Error updating listing:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
