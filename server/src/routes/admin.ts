import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { isAuthenticated, isAdmin, validateObjectId } from "../middleware";
import { updateListing, deleteListing, readAllListings } from "../services/listingService";
import { getListingModel } from "../db/connections";
import { ResearchArea, ResearchField, fieldColorKeys } from "../models/researchArea";
import { Department, DepartmentCategory, categoryColorKeys } from "../models/department";
import { invalidateConfigCache } from "../services/configService";
import { Fellowship } from "../models/fellowship";
import {
  updateFellowship,
  deleteFellowship,
  archiveFellowship,
  unarchiveFellowship,
} from "../services/fellowshipService";

const router = Router();

// All admin routes require authentication + admin role
router.use(isAuthenticated, isAdmin);

// ==================== LISTINGS ====================

// GET /admin/listings — fetch all listings with sorting, search, pagination, filters
router.get("/listings", async (req: Request, res: Response) => {
  try {
    const {
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      page = "1",
      pageSize = "25",
      archived,
      confirmed,
      audited,
    } = req.query;

    const filter: any = {};

    if (archived === "true") filter.archived = true;
    else if (archived === "false") filter.archived = false;

    if (confirmed === "true") filter.confirmed = true;
    else if (confirmed === "false") filter.confirmed = false;

    if (audited === "true") filter.audited = true;
    else if (audited === "false") filter.audited = { $ne: true };

    if (search && (search as string).trim()) {
      const searchRegex = { $regex: (search as string).trim(), $options: "i" };
      filter.$or = [
        { title: searchRegex },
        { ownerFirstName: searchRegex },
        { ownerLastName: searchRegex },
        { description: searchRegex },
        { ownerId: searchRegex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize as string, 10) || 25));

    // Build sort object
    let sort: any = {};
    const order = sortOrder === "asc" ? 1 : -1;

    if (sortBy === "descriptionLength") {
      // Special case: sort by computed field
      const pipeline: any[] = [
        { $match: filter },
        {
          $addFields: {
            descriptionLength: {
              $cond: {
                if: { $isArray: "$description" },
                then: 0,
                else: { $strLenCP: { $ifNull: ["$description", ""] } },
              },
            },
          },
        },
        { $sort: { descriptionLength: order, _id: 1 } },
        { $skip: (pageNum - 1) * pageSizeNum },
        { $limit: pageSizeNum },
        { $project: { embedding: 0 } },
      ];

      const [results, countResult] = await Promise.all([
        getListingModel().aggregate(pipeline),
        getListingModel().countDocuments(filter),
      ]);

      return res.json({
        listings: results,
        total: countResult,
        page: pageNum,
        pageSize: pageSizeNum,
        totalPages: Math.ceil(countResult / pageSizeNum),
      });
    }

    if (sortBy === "redFlags") {
      // Sort by computed red flag score
      // Higher score = more red flags
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

      const pipeline: any[] = [
        { $match: filter },
        {
          $addFields: {
            redFlagScore: {
              $add: [
                // No departments: +10
                { $cond: [{ $or: [{ $eq: [{ $size: { $ifNull: ["$departments", []] } }, 0] }, { $eq: ["$departments", null] }] }, 10, 0] },
                // No views: +5
                { $cond: [{ $eq: [{ $ifNull: ["$views", 0] }, 0] }, 5, 0] },
                // Low views (1-5): +2
                { $cond: [{ $and: [{ $gt: [{ $ifNull: ["$views", 0] }, 0] }, { $lte: [{ $ifNull: ["$views", 0] }, 5] }] }, 2, 0] },
                // Old listing (>2 years): +5
                { $cond: [{ $lt: ["$createdAt", twoYearsAgo] }, 5, 0] },
                // No research areas: +3
                { $cond: [{ $or: [{ $eq: [{ $size: { $ifNull: ["$researchAreas", []] } }, 0] }, { $eq: ["$researchAreas", null] }] }, 3, 0] },
                // Short description (<100 chars): +2
                {
                  $cond: [
                    { $lt: [{ $strLenCP: { $ifNull: ["$description", ""] } }, 100] },
                    2,
                    0,
                  ],
                },
              ],
            },
          },
        },
        { $sort: { redFlagScore: order, _id: 1 } },
        { $skip: (pageNum - 1) * pageSizeNum },
        { $limit: pageSizeNum },
        { $project: { embedding: 0 } },
      ];

      const [results, countResult] = await Promise.all([
        getListingModel().aggregate(pipeline),
        getListingModel().countDocuments(filter),
      ]);

      return res.json({
        listings: results,
        total: countResult,
        page: pageNum,
        pageSize: pageSizeNum,
        totalPages: Math.ceil(countResult / pageSizeNum),
      });
    }

    sort[sortBy as string] = order;
    sort._id = 1;

    const [listings, total] = await Promise.all([
      getListingModel()
        .find(filter)
        .select("-embedding")
        .sort(sort)
        .skip((pageNum - 1) * pageSizeNum)
        .limit(pageSizeNum)
        .lean(),
      getListingModel().countDocuments(filter),
    ]);

    res.json({
      listings,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
    });
  } catch (error) {
    console.error("Admin: Error fetching listings:", error);
    res.status(500).json({ error: "Failed to fetch listings" });
  }
});

// PUT /admin/listings/:id — update any listing (admin bypass)
router.put("/listings/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user as { netId?: string };
    const { data, resetCreatedAt } = req.body;

    let listing = await updateListing(req.params.id, currentUser.netId, data, true);

    // If resetCreatedAt is true, update the createdAt to same month/day but in 2025
    if (resetCreatedAt && listing) {
      const originalDate = new Date(listing.createdAt);
      const newCreatedAt = new Date(2025, originalDate.getMonth(), originalDate.getDate());

      // Use raw MongoDB driver to bypass Mongoose's immutable constraint on createdAt
      await getListingModel().collection.updateOne(
        { _id: new mongoose.Types.ObjectId(req.params.id) },
        { $set: { createdAt: newCreatedAt } }
      );
      listing = await getListingModel().findById(req.params.id).lean();
    }

    res.json({ listing });
  } catch (error) {
    console.error("Admin: Error updating listing:", error);
    res.status(400).json({ error: error.message });
  }
});

// DELETE /admin/listings/:id — delete any listing
router.delete("/listings/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    await deleteListing(req.params.id);
    res.json({ message: "Listing deleted" });
  } catch (error) {
    console.error("Admin: Error deleting listing:", error);
    res.status(400).json({ error: error.message });
  }
});

// ==================== RESEARCH AREAS ====================

// GET /admin/research-areas — get all research areas
router.get("/research-areas", async (_req: Request, res: Response) => {
  try {
    const areas = await ResearchArea.find().sort({ name: 1 }).lean();
    res.json({ researchAreas: areas });
  } catch (error) {
    console.error("Admin: Error fetching research areas:", error);
    res.status(500).json({ error: "Failed to fetch research areas" });
  }
});

// PUT /admin/research-areas/:id — update a research area
router.put("/research-areas/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const { name, field } = req.body;
    const update: any = {};

    if (name !== undefined) update.name = name.trim();
    if (field !== undefined) {
      if (!Object.values(ResearchField).includes(field)) {
        return res.status(400).json({ error: "Invalid field value" });
      }
      update.field = field;
      update.colorKey = fieldColorKeys[field as ResearchField] || "gray";
    }

    const area = await ResearchArea.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!area) {
      return res.status(404).json({ error: "Research area not found" });
    }

    invalidateConfigCache();
    res.json({ researchArea: area });
  } catch (error) {
    console.error("Admin: Error updating research area:", error);
    res.status(400).json({ error: error.message });
  }
});

// DELETE /admin/research-areas/:id — delete a research area
router.delete("/research-areas/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const area = await ResearchArea.findByIdAndDelete(req.params.id);
    if (!area) {
      return res.status(404).json({ error: "Research area not found" });
    }

    invalidateConfigCache();
    res.json({ message: "Research area deleted" });
  } catch (error) {
    console.error("Admin: Error deleting research area:", error);
    res.status(400).json({ error: error.message });
  }
});

// ==================== DEPARTMENTS ====================

// GET /admin/departments — get all departments
router.get("/departments", async (_req: Request, res: Response) => {
  try {
    const departments = await Department.find().sort({ abbreviation: 1 }).lean();
    res.json({ departments });
  } catch (error) {
    console.error("Admin: Error fetching departments:", error);
    res.status(500).json({ error: "Failed to fetch departments" });
  }
});

// POST /admin/departments — create a new department
router.post("/departments", async (req: Request, res: Response) => {
  try {
    const { abbreviation, name, displayName, categories, primaryCategory } = req.body;

    if (!abbreviation || !name || !primaryCategory) {
      return res.status(400).json({ error: "abbreviation, name, and primaryCategory are required" });
    }

    const colorKey = categoryColorKeys[primaryCategory as DepartmentCategory] ?? 0;

    const dept = new Department({
      abbreviation: abbreviation.trim(),
      name: name.trim(),
      displayName: displayName || `${abbreviation.trim()} - ${name.trim()}`,
      categories: categories || [primaryCategory],
      primaryCategory,
      colorKey,
    });

    await dept.save();
    invalidateConfigCache();
    res.status(201).json({ department: dept });
  } catch (error) {
    console.error("Admin: Error creating department:", error);
    res.status(400).json({ error: error.message });
  }
});

// PUT /admin/departments/:id — update a department
router.put("/departments/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const { abbreviation, name, displayName, categories, primaryCategory, isActive } = req.body;
    const update: any = {};

    if (abbreviation !== undefined) update.abbreviation = abbreviation.trim();
    if (name !== undefined) update.name = name.trim();
    if (displayName !== undefined) update.displayName = displayName.trim();
    if (categories !== undefined) update.categories = categories;
    if (primaryCategory !== undefined) {
      update.primaryCategory = primaryCategory;
      update.colorKey = categoryColorKeys[primaryCategory as DepartmentCategory] ?? 0;
    }
    if (isActive !== undefined) update.isActive = isActive;

    const dept = await Department.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!dept) {
      return res.status(404).json({ error: "Department not found" });
    }

    invalidateConfigCache();
    res.json({ department: dept });
  } catch (error) {
    console.error("Admin: Error updating department:", error);
    res.status(400).json({ error: error.message });
  }
});

// DELETE /admin/departments/:id — delete a department
router.delete("/departments/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const dept = await Department.findByIdAndDelete(req.params.id);
    if (!dept) {
      return res.status(404).json({ error: "Department not found" });
    }

    invalidateConfigCache();
    res.json({ message: "Department deleted" });
  } catch (error) {
    console.error("Admin: Error deleting department:", error);
    res.status(400).json({ error: error.message });
  }
});

// ==================== URL CHECKING ====================

// POST /admin/check-urls — check reachability of URLs
router.post("/check-urls", async (req: Request, res: Response) => {
  try {
    const { urls } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "urls array is required" });
    }

    const results = await Promise.all(
      urls.map(async (url: string) => {
        try {
          let normalizedUrl = url;
          if (!/^https?:\/\//i.test(normalizedUrl)) {
            normalizedUrl = "https://" + normalizedUrl;
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(normalizedUrl, {
            method: "HEAD",
            signal: controller.signal,
            redirect: "follow",
          });

          clearTimeout(timeout);
          return { url, status: response.status, reachable: response.ok };
        } catch (err: any) {
          return { url, status: 0, reachable: false, error: err.name === "AbortError" ? "Timeout" : "Unreachable" };
        }
      })
    );

    res.json({ results });
  } catch (error) {
    console.error("Admin: Error checking URLs:", error);
    res.status(500).json({ error: "Failed to check URLs" });
  }
});

// ==================== FELLOWSHIPS ====================

// GET /admin/fellowships — fetch all fellowships with sorting, search, pagination, filters
router.get("/fellowships", async (req: Request, res: Response) => {
  try {
    const {
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      page = "1",
      pageSize = "25",
      archived,
      audited,
    } = req.query;

    const filter: any = {};

    if (archived === "true") filter.archived = true;
    else if (archived === "false") filter.archived = false;

    if (audited === "true") filter.audited = true;
    else if (audited === "false") filter.audited = { $ne: true };

    if (search && (search as string).trim()) {
      const searchRegex = { $regex: (search as string).trim(), $options: "i" };
      filter.$or = [
        { title: searchRegex },
        { summary: searchRegex },
        { description: searchRegex },
        { contactEmail: searchRegex },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize as string, 10) || 25));

    const sort: any = {};
    const order = sortOrder === "asc" ? 1 : -1;
    sort[sortBy as string] = order;
    sort._id = 1;

    const [fellowships, total] = await Promise.all([
      Fellowship.find(filter)
        .sort(sort)
        .skip((pageNum - 1) * pageSizeNum)
        .limit(pageSizeNum)
        .lean(),
      Fellowship.countDocuments(filter),
    ]);

    res.json({
      fellowships,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
    });
  } catch (error) {
    console.error("Admin: Error fetching fellowships:", error);
    res.status(500).json({ error: "Failed to fetch fellowships" });
  }
});

// PUT /admin/fellowships/:id — update a fellowship
router.put("/fellowships/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const fellowship = await updateFellowship(req.params.id, req.body.data);
    res.json({ fellowship });
  } catch (error) {
    console.error("Admin: Error updating fellowship:", error);
    res.status(400).json({ error: error.message });
  }
});

// PUT /admin/fellowships/:id/archive — archive a fellowship
router.put("/fellowships/:id/archive", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const fellowship = await archiveFellowship(req.params.id);
    res.json({ fellowship });
  } catch (error) {
    console.error("Admin: Error archiving fellowship:", error);
    res.status(400).json({ error: error.message });
  }
});

// PUT /admin/fellowships/:id/unarchive — unarchive a fellowship
router.put("/fellowships/:id/unarchive", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const fellowship = await unarchiveFellowship(req.params.id);
    res.json({ fellowship });
  } catch (error) {
    console.error("Admin: Error unarchiving fellowship:", error);
    res.status(400).json({ error: error.message });
  }
});

// DELETE /admin/fellowships/:id — delete a fellowship
router.delete("/fellowships/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    await deleteFellowship(req.params.id);
    res.json({ message: "Fellowship deleted" });
  } catch (error) {
    console.error("Admin: Error deleting fellowship:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
