/**
 * Faculty profile service for self-editing, verification, and department cascading.
 */
import { User } from "../models/user";
import { getListingModel } from "../db/connections";

/**
 * Cascade a professor's department data to all their listings.
 * - For owned listings: set departments from owner's profile
 * - For co-PI listings: merge departments from all PIs (owner's primary first)
 */
export const cascadeDepartmentsToListings = async (netid: string) => {
  const user = await User.findOne({ netid }).lean();
  if (!user) return;

  const userDepts = [
    (user as any).primary_department,
    ...((user as any).secondary_departments || []),
  ].filter(Boolean);

  const ownedListings = await getListingModel()
    .find({ ownerId: netid })
    .lean();

  for (const listing of ownedListings) {
    const coPIIds = (listing.professorIds || []).filter(
      (id: string) => id !== netid
    );

    let finalDepts: string[];

    if (coPIIds.length > 0) {
      const coPIs = await User.find({ netid: { $in: coPIIds } })
        .select("primary_department secondary_departments")
        .lean();

      const allDepts = new Set<string>(userDepts);
      for (const pi of coPIs) {
        if ((pi as any).primary_department)
          allDepts.add((pi as any).primary_department);
        for (const d of (pi as any).secondary_departments || []) {
          allDepts.add(d);
        }
      }
      finalDepts = Array.from(allDepts);
    } else {
      finalDepts = userDepts;
    }

    await getListingModel().findByIdAndUpdate(listing._id, {
      departments: finalDepts,
      ownerPrimaryDepartment: (user as any).primary_department || "",
      ownerTitle: (user as any).title || "",
    });
  }

  const coPIListings = await getListingModel()
    .find({ professorIds: netid, ownerId: { $ne: netid } })
    .lean();

  for (const listing of coPIListings) {
    const allPIIds = [
      listing.ownerId,
      ...(listing.professorIds || []),
    ];
    const uniqueIds = [...new Set(allPIIds)];

    const allPIs = await User.find({ netid: { $in: uniqueIds } })
      .select("primary_department secondary_departments")
      .lean();

    const owner = allPIs.find((p: any) => p.netid === listing.ownerId);
    const ownerPrimary = (owner as any)?.primary_department;

    const allDepts = new Set<string>();
    if (ownerPrimary) allDepts.add(ownerPrimary);

    for (const pi of allPIs) {
      if ((pi as any).primary_department)
        allDepts.add((pi as any).primary_department);
      for (const d of (pi as any).secondary_departments || []) {
        allDepts.add(d);
      }
    }

    await getListingModel().findByIdAndUpdate(listing._id, {
      departments: Array.from(allDepts),
    });
  }
};

/**
 * Get a faculty profile by netid, optionally including publications.
 */
export const getProfileByNetid = async (
  netid: string,
  includePublications = false
) => {
  let query = User.findOne({ netid });
  if (includePublications) {
    query = query.select("+publications");
  }
  const user = await query.lean();
  return user;
};

/**
 * Update allowed profile fields for a professor.
 * Returns the updated user.
 */
const ALLOWED_SELF_UPDATE_FIELDS = [
  "bio",
  "primary_department",
  "secondary_departments",
  "research_interests",
  "topics",
  "image_url",
  "profile_urls",
  "website",
];

export const updateOwnProfile = async (netid: string, data: any) => {
  const update: Record<string, any> = {};

  for (const field of ALLOWED_SELF_UPDATE_FIELDS) {
    if (data[field] !== undefined) {
      update[field] = data[field];
    }
  }

  if (
    update.primary_department !== undefined ||
    update.secondary_departments !== undefined
  ) {
    const current = await User.findOne({ netid }).lean();
    const primary =
      update.primary_department ?? (current as any)?.primary_department ?? "";
    const secondary =
      update.secondary_departments ??
      (current as any)?.secondary_departments ??
      [];
    update.departments = [primary, ...secondary].filter(Boolean);
  }

  const user = await User.findOneAndUpdate({ netid }, update, {
    new: true,
    runValidators: true,
  }).lean();

  return user;
};

/**
 * Admin: update any profile field.
 */
const ADMIN_UPDATE_FIELDS = [
  ...ALLOWED_SELF_UPDATE_FIELDS,
  "fname",
  "lname",
  "email",
  "title",
  "h_index",
  "orcid",
  "openalex_id",
  "profileVerified",
  "userType",
  "userConfirmed",
];

export const adminUpdateProfile = async (netid: string, data: any) => {
  const update: Record<string, any> = {};

  for (const field of ADMIN_UPDATE_FIELDS) {
    if (data[field] !== undefined) {
      update[field] = data[field];
    }
  }

  if (
    update.primary_department !== undefined ||
    update.secondary_departments !== undefined
  ) {
    const current = await User.findOne({ netid }).lean();
    const primary =
      update.primary_department ?? (current as any)?.primary_department ?? "";
    const secondary =
      update.secondary_departments ??
      (current as any)?.secondary_departments ??
      [];
    update.departments = [primary, ...secondary].filter(Boolean);
  }

  if (data.publications !== undefined) {
    update.publications = data.publications;
  }

  const user = await User.findOneAndUpdate({ netid }, update, {
    new: true,
    runValidators: true,
  })
    .select("+publications")
    .lean();

  return user;
};
