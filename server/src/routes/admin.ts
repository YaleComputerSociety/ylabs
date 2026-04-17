/**
 * Admin-only routes for managing listings, fellowships, users, and profiles.
 */
import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import dns from "dns/promises";
import net from "net";
import { isAuthenticated, isAdmin, validateObjectId, validateNetid } from "../middleware/index";
import { updateListing, deleteListing, readAllListings } from "../services/listingService";
import { getListingModel } from "../db/connections";
import { ResearchArea, ResearchField, fieldColorKeys } from "../models/researchArea";
import { Department, DepartmentCategory, categoryColorKeys } from "../models/department";
import { invalidateConfigCache } from "../services/configService";
import { Fellowship } from "../models/fellowship";
import { User } from "../models/user";
import {
  updateFellowship,
  deleteFellowship,
  archiveFellowship,
  unarchiveFellowship,
} from "../services/fellowshipService";
import {
  adminUpdateProfile,
  cascadeDepartmentsToListings,
} from "../services/profileService";
import { buildSafeSearchRegex } from "../utils/regex";

const router = Router();

router.use(isAuthenticated, isAdmin);

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
      const searchRegex = buildSafeSearchRegex((search as string).trim());
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

    let sort: any = {};
    const order = sortOrder === "asc" ? 1 : -1;

    if (sortBy === "descriptionLength") {
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
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

      const pipeline: any[] = [
        { $match: filter },
        {
          $addFields: {
            redFlagScore: {
              $add: [
                { $cond: [{ $or: [{ $eq: [{ $size: { $ifNull: ["$departments", []] } }, 0] }, { $eq: ["$departments", null] }] }, 10, 0] },
                { $cond: [{ $eq: [{ $ifNull: ["$views", 0] }, 0] }, 5, 0] },
                { $cond: [{ $and: [{ $gt: [{ $ifNull: ["$views", 0] }, 0] }, { $lte: [{ $ifNull: ["$views", 0] }, 5] }] }, 2, 0] },
                { $cond: [{ $lt: ["$createdAt", twoYearsAgo] }, 5, 0] },
                { $cond: [{ $or: [{ $eq: [{ $size: { $ifNull: ["$researchAreas", []] } }, 0] }, { $eq: ["$researchAreas", null] }] }, 3, 0] },
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

router.put("/listings/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const currentUser = req.user as { netId?: string };
    const { data, resetCreatedAt } = req.body;

    let listing = await updateListing(req.params.id, currentUser.netId as string, data, true);

    if (resetCreatedAt && listing) {
      const originalDate = new Date(listing.createdAt);
      const newCreatedAt = new Date(2025, originalDate.getMonth(), originalDate.getDate());

      await getListingModel().collection.updateOne(
        { _id: new mongoose.Types.ObjectId(req.params.id) },
        { $set: { createdAt: newCreatedAt } }
      );
      listing = await getListingModel().findById(req.params.id).lean();
    }

    res.json({ listing });
  } catch (error) {
    console.error("Admin: Error updating listing:", error);
    res.status(400).json({ error: "Request failed" });
  }
});

router.delete("/listings/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    await deleteListing(req.params.id);
    res.json({ message: "Listing deleted" });
  } catch (error) {
    console.error("Admin: Error deleting listing:", error);
    res.status(400).json({ error: "Request failed" });
  }
});

router.get("/research-areas", async (_req: Request, res: Response) => {
  try {
    const areas = await ResearchArea.find().sort({ name: 1 }).lean();
    res.json({ researchAreas: areas });
  } catch (error) {
    console.error("Admin: Error fetching research areas:", error);
    res.status(500).json({ error: "Failed to fetch research areas" });
  }
});

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
    res.status(400).json({ error: "Request failed" });
  }
});

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
    res.status(400).json({ error: "Request failed" });
  }
});

router.get("/departments", async (_req: Request, res: Response) => {
  try {
    const departments = await Department.find().sort({ abbreviation: 1 }).lean();
    res.json({ departments });
  } catch (error) {
    console.error("Admin: Error fetching departments:", error);
    res.status(500).json({ error: "Failed to fetch departments" });
  }
});

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
    res.status(400).json({ error: "Request failed" });
  }
});

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
    res.status(400).json({ error: "Request failed" });
  }
});

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
    res.status(400).json({ error: "Request failed" });
  }
});

const isPrivateAddress = (addr: string): boolean => {
  const family = net.isIP(addr);
  if (family === 0) return true;
  if (family === 4) {
    const parts = addr.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }
  const lower = addr.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80:')) return true;
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return false;
};

const isPublicHostname = async (hostname: string): Promise<boolean> => {
  if (net.isIP(hostname)) return !isPrivateAddress(hostname);
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.length === 0) return false;
    return records.every((r) => !isPrivateAddress(r.address));
  } catch {
    return false;
  }
};

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
          if (!/^https?:\/\//.test(normalizedUrl)) {
            normalizedUrl = "https://" + normalizedUrl;
          }

          let parsed: URL;
          try {
            parsed = new URL(normalizedUrl);
          } catch {
            return { url, status: 0, reachable: false, error: "Invalid URL" };
          }

          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { url, status: 0, reachable: false, error: "Unsupported scheme" };
          }

          if (!(await isPublicHostname(parsed.hostname))) {
            return { url, status: 0, reachable: false, error: "Blocked host" };
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(parsed.toString(), {
            method: "HEAD",
            signal: controller.signal,
            redirect: "manual",
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

router.get("/profiles", async (req: Request, res: Response) => {
  try {
    const {
      search,
      sortBy = "lname",
      sortOrder = "asc",
      page = "1",
      pageSize = "25",
      profileVerified,
      hasListings,
    } = req.query;

    const filter: any = {
      userType: { $in: ["professor", "faculty"] },
    };

    if (profileVerified === "true") filter.profileVerified = true;
    else if (profileVerified === "false")
      filter.profileVerified = { $ne: true };

    if (hasListings === "true")
      filter.ownListings = { $exists: true, $not: { $size: 0 } };
    else if (hasListings === "false")
      filter.$or = [
        { ownListings: { $exists: false } },
        { ownListings: { $size: 0 } },
      ];

    if (search && (search as string).trim()) {
      const searchRegex = buildSafeSearchRegex((search as string).trim());
      const searchOr = [
        { fname: searchRegex },
        { lname: searchRegex },
        { netid: searchRegex },
        { email: searchRegex },
        { primary_department: searchRegex },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    const pageNum = Math.max(
      1,
      parseInt(page as string, 10) || 1
    );
    const pageSizeNum = Math.min(
      100,
      Math.max(1, parseInt(pageSize as string, 10) || 25)
    );

    const sort: any = {};
    const order = sortOrder === "asc" ? 1 : -1;
    sort[sortBy as string] = order;
    sort._id = 1;

    const [profiles, total] = await Promise.all([
      User.find(filter)
        .select("-publications")
        .sort(sort)
        .skip((pageNum - 1) * pageSizeNum)
        .limit(pageSizeNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      profiles,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil(total / pageSizeNum),
    });
  } catch (error: any) {
    console.error("Admin: Error fetching profiles:", error);
    res.status(500).json({ error: "Failed to fetch profiles" });
  }
});

router.get("/profiles/:netid", validateNetid("netid"), async (req: Request, res: Response) => {
  try {
    const user = await User.findOne({ netid: req.params.netid })
      .select("+publications")
      .lean();

    if (!user) {
      return res.status(404).json({ error: "Profile not found" });
    }

    res.json({ profile: user });
  } catch (error: any) {
    console.error("Admin: Error fetching profile:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

router.put("/profiles/:netid", validateNetid("netid"), async (req: Request, res: Response) => {
  try {
    const data = req.body?.data;
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Missing data payload" });
    }

    const profile = await adminUpdateProfile(req.params.netid, data);

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    if (
      data.primary_department !== undefined ||
      data.secondary_departments !== undefined
    ) {
      await cascadeDepartmentsToListings(req.params.netid);
    }

    res.json({ profile });
  } catch (error: any) {
    console.error("Admin: Error updating profile:", error);
    res.status(400).json({ error: "Request failed" });
  }
});

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
      const searchRegex = buildSafeSearchRegex((search as string).trim());
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

router.put("/fellowships/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const fellowship = await updateFellowship(req.params.id, req.body.data);
    res.json({ fellowship });
  } catch (error) {
    console.error("Admin: Error updating fellowship:", error);
    res.status(400).json({ error: "Request failed" });
  }
});

router.put("/fellowships/:id/archive", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const fellowship = await archiveFellowship(req.params.id);
    res.json({ fellowship });
  } catch (error) {
    console.error("Admin: Error archiving fellowship:", error);
    res.status(400).json({ error: "Request failed" });
  }
});

router.put("/fellowships/:id/unarchive", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    const fellowship = await unarchiveFellowship(req.params.id);
    res.json({ fellowship });
  } catch (error) {
    console.error("Admin: Error unarchiving fellowship:", error);
    res.status(400).json({ error: "Request failed" });
  }
});

router.delete("/fellowships/:id", validateObjectId("id"), async (req: Request, res: Response) => {
  try {
    await deleteFellowship(req.params.id);
    res.json({ message: "Fellowship deleted" });
  } catch (error) {
    console.error("Admin: Error deleting fellowship:", error);
    res.status(400).json({ error: "Request failed" });
  }
});

export default router;
