/**
 * Development-only seed routes for the faculty scraper.
 * These routes have NO user auth — callers must present a matching SEED_TOKEN header.
 * Still only mounted when NODE_ENV=development, but the token is the hard gate.
 */
import { Router, Request, Response, NextFunction } from "express";
import { createUser, validateUser, updateUser } from "../services/userService";
import { updateListing, readAllListings } from "../services/listingService";
import { validateNetid } from "../middleware/validation";

const router = Router();

const requireSeedToken = (req: Request, res: Response, next: NextFunction) => {
  const expected = process.env.SEED_TOKEN;
  if (!expected || expected.length < 16) {
    return res.status(503).json({ error: "Seed routes disabled" });
  }
  const provided = req.get("x-seed-token");
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "Invalid seed token" });
  }
  next();
};

router.use(requireSeedToken);

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
    res.status(400).json({ error: "Request failed" });
  }
});

router.put("/users/:netid", validateNetid("netid"), async (req: Request, res: Response) => {
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
    res.status(400).json({ error: "Request failed" });
  }
});

router.get("/listings", async (req: Request, res: Response) => {
  try {
    const listings = await readAllListings();
    res.json({ results: listings });
  } catch (error: any) {
    console.error("Seed: Error fetching listings:", error);
    res.status(500).json({ error: "Request failed" });
  }
});

router.put("/listings/:id", async (req: Request, res: Response) => {
  try {
    const { departments } = req.body;
    const listing = await updateListing(req.params.id, '' as string, { departments }, true);
    res.json({ listing });
  } catch (error: any) {
    console.error("Seed: Error updating listing:", error);
    res.status(400).json({ error: "Request failed" });
  }
});

export default router;
